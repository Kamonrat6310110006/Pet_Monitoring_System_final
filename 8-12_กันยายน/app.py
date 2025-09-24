from flask import Flask, Response, jsonify, request
from flask_cors import CORS
import mysql.connector
import cv2
import os
from threading import Lock

app = Flask(__name__)
CORS(app)

# =========================================
# A) CAMERA CONFIG 
# =========================================
# แก้/เพิ่มกล้องได้ที่นี่ (ห้อง: garden, garage, kitchen, hall)
ROOMS_CFG = [
    {
        "name": "garden",
        "cameras": [
            {"label": "Cam1", "rtsp_url": "rtsp://user:pass@10.0.0.10/stream1"},
            {"label": "Cam2", "rtsp_url": "rtsp://user:pass@10.0.0.11/stream1"},
        ],
    },
    {
        "name": "garage",
        "cameras": [
            {"label": "Cam3", "rtsp_url": "rtsp://user:pass@10.0.0.12/stream1"},
        ],
    },
    {
        "name": "kitchen",
        "cameras": [
            {"label": "Cam4", "rtsp_url": "rtsp://user:pass@10.0.0.13/stream1"},
        ],
    },
    {
        "name": "hall",
        "cameras": [
            {"label": "Cam5", "rtsp_url": "rtsp://admin:05032544@192.168.22.94:10554/tcp/av0_0"},
        ],
    },
]

_cam_lock = Lock()

def get_rtsp_by_room_index(room_name: str, index: int):
    with _cam_lock:
        room = next((r for r in ROOMS_CFG if r.get("name") == room_name), None)
        if not room:
            return None
        cams = room.get("cameras", [])
        if index < 0 or index >= len(cams):
            return None
        return cams[index].get("rtsp_url")

# =========================================
# B) RTSP STREAMING (MJPEG)
# =========================================
def generate_frames_rtsp(rtsp_url: str):
    """อ่านเฟรมจาก RTSP แล้วส่งเป็น MJPEG multipart"""
    cap = cv2.VideoCapture(rtsp_url)
    if not cap.isOpened():
        print("❌ ไม่สามารถเชื่อมต่อกล้อง RTSP ได้:", rtsp_url)
        return
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            ret, buf = cv2.imencode(".jpg", frame)
            if not ret:
                break
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")
    finally:
        cap.release()

# สตรีมกล้องตามห้อง/ลำดับกล้อง (index เริ่ม 0)
@app.route("/video_feed/<room_name>/<int:index>")
def video_feed_room_index(room_name, index):
    rtsp = get_rtsp_by_room_index(room_name, index)
    if not rtsp:
        return Response("camera not found", status=404)
    return Response(
        generate_frames_rtsp(rtsp),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )

# ให้หน้าเว็บโหลดรายการห้อง–กล้อง (ไม่เปิดเผย RTSP)
@app.route("/api/rooms", methods=["GET"])
def api_rooms():
    with _cam_lock:
        result = [
            {
                "name": r["name"],
                "cameras": [
                    {"label": c.get("label", f"Camera {i+1}"), "index": i}
                    for i, c in enumerate(r.get("cameras", []))
                ],
            }
            for r in ROOMS_CFG
        ]
    return jsonify(result)


# =========================================
# C) DB CONFIG 
# =========================================
db_config = {
    "host": "localhost",
    "user": "root",
    "password": "root",
    "database": "pet_monitoring",
}

ACTIVE_CONFIG_ID = 2
DEFAULT_CONFIG_ID = 1

SNAKE_TO_CAMEL = {
    "alert_no_cat": "alertNoCat",
    "alert_no_eat": "alertNoEating",
    "alert_no_excrete_min": "minExcretion",
    "alert_no_excrete_max": "maxExcretion",
    "alert_no_sleep_min": "minSleep",
    "alert_no_sleep_max": "maxSleep",
    "max_supported_cats": "maxCats",
}
CAMEL_TO_SNAKE = {v: k for k, v in SNAKE_TO_CAMEL.items()}

def row_to_camel(row_dict):
    return {SNAKE_TO_CAMEL.get(k, k): v for k, v in row_dict.items()}

def apply_config_cursor(cursor, config_id):
    cursor.execute("SELECT * FROM system_config WHERE id=%s", (config_id,))
    row = cursor.fetchone()
    return row_to_camel(row) if row else None

# =========================================
# D) SYSTEM CONFIG APIs 
# =========================================
from flask import jsonify

@app.route("/api/system_config", methods=["GET"])
def get_system_config():
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        cfg = apply_config_cursor(cursor, ACTIVE_CONFIG_ID)
        if not cfg:
            return jsonify({"message": "Error fetching system config"}), 500
        return jsonify(cfg)
    finally:
        cursor.close()
        connection.close()

@app.route("/api/system_config", methods=["POST"])
def update_system_config():
    new_config = request.json or {}
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM system_config WHERE id=%s", (ACTIVE_CONFIG_ID,))
        current_cfg_snake = cursor.fetchone()
        if not current_cfg_snake:
            return jsonify({"message": "Active config not found"}), 404

        merged = {}
        for snake_key in SNAKE_TO_CAMEL.keys():
            camel_key = SNAKE_TO_CAMEL[snake_key]
            merged[snake_key] = new_config.get(camel_key, current_cfg_snake.get(snake_key))

        update_sql = """
            UPDATE system_config
            SET alert_no_cat=%s,
                alert_no_eat=%s,
                alert_no_excrete_min=%s,
                alert_no_excrete_max=%s,
                alert_no_sleep_min=%s,
                alert_no_sleep_max=%s,
                max_supported_cats=%s
            WHERE id=%s
        """
        cursor2 = connection.cursor()
        cursor2.execute(
            update_sql,
            (
                merged["alert_no_cat"],
                merged["alert_no_eat"],
                merged["alert_no_excrete_min"],
                merged["alert_no_excrete_max"],
                merged["alert_no_sleep_min"],
                merged["alert_no_sleep_max"],
                merged["max_supported_cats"],
                ACTIVE_CONFIG_ID,
            ),
        )
        connection.commit()
        cursor2.close()
        return jsonify({"message": "Config updated successfully"})
    finally:
        cursor.close()
        connection.close()

@app.route("/api/system_config/reset", methods=["POST"])
def reset_system_config():
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM system_config WHERE id=%s", (DEFAULT_CONFIG_ID,))
        default_config = cursor.fetchone()
        if not default_config:
            return jsonify({"message": "Error resetting system config"}), 500

        update_query = """
            UPDATE system_config
            SET alert_no_cat=%s,
                alert_no_eat=%s,
                alert_no_excrete_min=%s,
                alert_no_excrete_max=%s,
                alert_no_sleep_min=%s,
                alert_no_sleep_max=%s,
                max_supported_cats=%s
            WHERE id=%s
        """
        cursor2 = connection.cursor()
        cursor2.execute(
            update_query,
            (
                default_config["alert_no_cat"],
                default_config["alert_no_eat"],
                default_config["alert_no_excrete_min"],
                default_config["alert_no_excrete_max"],
                default_config["alert_no_sleep_min"],
                default_config["alert_no_sleep_max"],
                default_config["max_supported_cats"],
                ACTIVE_CONFIG_ID,
            ),
        )
        connection.commit()
        cursor2.close()
        return jsonify({"message": "System config has been reset to default values"})
    finally:
        cursor.close()
        connection.close()

# =========================================
# E) ALERTS 
# =========================================
@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        # 0) โหลดค่าคอนฟิก
        cursor.execute("SELECT * FROM system_config WHERE id=%s", (ACTIVE_CONFIG_ID,))
        config_row = cursor.fetchone()
        if not config_row:
            return jsonify([])

        cfg = row_to_camel(config_row)
        alerts = []

        # 1) ไม่พบแมวนานเกินกำหนด (ยังเหมือนเดิม)
        cursor.execute("""
            SELECT c.name, MAX(m.enter_time) AS last_seen
            FROM cats c
            LEFT JOIN cat_movements m ON c.name = m.cat_name
            GROUP BY c.name
        """)
        for row in cursor.fetchall():
            if row["last_seen"]:
                cursor.execute("SELECT TIMESTAMPDIFF(HOUR, %s, NOW()) AS hours", (row["last_seen"],))
                diff = cursor.fetchone()["hours"]
                if diff is not None and cfg.get("alertNoCat") is not None and diff >= cfg["alertNoCat"]:
                    alerts.append({
                        "type": "no_cat",
                        "cat": row["name"],
                        "message": f"ไม่พบ {row['name']} เกิน {cfg['alertNoCat']} ชั่วโมง",
                    })

        # 2) การกินอาหาร — เตือนเฉพาะเมื่อ "วันนี้มีข้อมูลจริง"
        cursor.execute("""
            SELECT cat_name, COUNT(*) AS eats
            FROM cat_activities
            WHERE activity_type='eat' AND DATE(start_time)=CURDATE()
            GROUP BY cat_name
        """)
        eat_map = {r["cat_name"]: r["eats"] for r in cursor.fetchall()}

        cursor.execute("SELECT name FROM cats")
        for cat in cursor.fetchall():
            name = cat["name"]
            if name in eat_map:  # มีข้อมูลของวันนี้เท่านั้นจึงพิจารณา
                need = cfg.get("alertNoEating")
                if need is not None and eat_map[name] < need:
                    alerts.append({
                        "type": "no_eating",
                        "cat": name,
                        "message": f"{name} กินอาหารน้อยกว่า {need} ครั้ง/วัน",
                    })
            # else: วันนี้ไม่มีข้อมูล -> ไม่เตือน

        # 3) การขับถ่าย — เตือนเฉพาะเมื่อ "วันนี้มีข้อมูลจริง"
        cursor.execute("""
            SELECT cat_name, COUNT(*) AS excretes
            FROM cat_activities
            WHERE activity_type='excrete' AND DATE(start_time)=CURDATE()
            GROUP BY cat_name
        """)
        excrete_map = {r["cat_name"]: r["excretes"] for r in cursor.fetchall()}

        cursor.execute("SELECT name FROM cats")
        for cat in cursor.fetchall():
            name = cat["name"]
            if name in excrete_map:  # มีข้อมูลของวันนี้เท่านั้นจึงพิจารณา
                count = excrete_map[name]
                if cfg.get("minExcretion") is not None and count < cfg["minExcretion"]:
                    alerts.append({
                        "type": "low_excrete",
                        "cat": name,
                        "message": f"{name} ขับถ่ายน้อยกว่าที่กำหนด ({count}/{cfg['minExcretion']})",
                    })
                if cfg.get("maxExcretion") is not None and count > cfg["maxExcretion"]:
                    alerts.append({
                        "type": "high_excrete",
                        "cat": name,
                        "message": f"{name} ขับถ่ายมากกว่าที่กำหนด ({count}/{cfg['maxExcretion']})",
                    })
            # else: วันนี้ไม่มีข้อมูล -> ไม่เตือน

        # 4) การนอน — เตือนเฉพาะเมื่อ "วันนี้มีข้อมูลจริง"
        cursor.execute("""
            SELECT cat_name, SUM(duration_minutes) AS sleep_minutes
            FROM cat_activities
            WHERE activity_type='sleep' AND DATE(start_time)=CURDATE()
            GROUP BY cat_name
        """)
        # หมายเหตุ: ถ้ามีเรคอร์ดจริงแต่รวมได้ 0 นาที => นับว่า "มีข้อมูล" และสามารถเตือน low_sleep ได้
        sleep_map = {r["cat_name"]: (r["sleep_minutes"] if r["sleep_minutes"] is not None else None)
                     for r in cursor.fetchall()}

        cursor.execute("SELECT name FROM cats")
        for cat in cursor.fetchall():
            name = cat["name"]
            if name in sleep_map and sleep_map[name] is not None:
                mins = sleep_map[name]
                hours = (mins or 0) / 60.0
                if cfg.get("minSleep") is not None and hours < cfg["minSleep"]:
                    alerts.append({
                        "type": "low_sleep",
                        "cat": name,
                        "message": f"{name} นอนน้อยเกินไป {hours:.1f} ชม. (min {cfg['minSleep']})",
                    })
                if cfg.get("maxSleep") is not None and hours > cfg["maxSleep"]:
                    alerts.append({
                        "type": "high_sleep",
                        "cat": name,
                        "message": f"{name} นอนมากเกินไป {hours:.1f} ชม. (max {cfg['maxSleep']})",
                    })
            # else: วันนี้ไม่มีข้อมูล -> ไม่เตือน

        return jsonify(alerts)
    finally:
        cursor.close()
        connection.close()


# =========================================
# F) CATS & ACTIVITIES 
# =========================================
@app.route("/api/cats", methods=["GET"])
def get_cats():
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        query = """
            SELECT c.name, c.image_url, c.status, r.name AS current_room
            FROM cats c
            LEFT JOIN (
                SELECT cat_name, room_name
                FROM cat_movements
                WHERE exit_time IS NULL
            ) cm ON c.name = cm.cat_name
            LEFT JOIN rooms r ON cm.room_name = r.name
        """
        cursor.execute(query)
        results = cursor.fetchall()
        return jsonify(results)
    finally:
        cursor.close()
        connection.close()

@app.route("/api/cat_activities", methods=["GET"])
def get_cat_activities():
    cat_name = request.args.get("cat_name")
    start = request.args.get("start_date")
    end = request.args.get("end_date")
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        query = """
            SELECT cat_name, activity_type, start_time, end_time, duration_minutes
            FROM cat_activities
            WHERE (%s IS NULL OR cat_name = %s)
              AND (%s IS NULL OR DATE(start_time) >= %s)
              AND (%s IS NULL OR DATE(end_time) <= %s)
            ORDER BY start_time ASC
        """
        cursor.execute(query, (cat_name, cat_name, start, start, end, end))
        results = cursor.fetchall()
        return jsonify(results)
    finally:
        cursor.close()
        connection.close()

# =========================================
# MAIN
# =========================================
if __name__ == "__main__":
    app.run(debug=True, port=5000)
