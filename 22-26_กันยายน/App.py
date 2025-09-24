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
# E) ALERTS (Persistent)
# =========================================
from datetime import datetime
from flask import request

def _compute_alerts_today(cursor):
    """คำนวณ Alert ของ 'วันนี้' เทียบกับ system_config แล้วคืน list ของ alerts"""
    cursor.execute("SELECT * FROM system_config WHERE id=%s", (ACTIVE_CONFIG_ID,))
    config_row = cursor.fetchone()
    if not config_row:
        return []

    cfg = row_to_camel(config_row)
    alerts = []

    # 1) ไม่พบแมวนานเกินกำหนด (ชั่วโมง)
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

    # 2) กินอาหาร (วันนี้)
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
        if name in eat_map:
            need = cfg.get("alertNoEating")
            if need is not None and eat_map[name] < need:
                alerts.append({
                    "type": "no_eating",
                    "cat": name,
                    "message": f"{name} กินอาหารน้อยกว่า {need} ครั้ง/วัน",
                })

    # 3) ขับถ่าย (วันนี้)
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
        if name in excrete_map:
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

    # 4) การนอน (วันนี้)
    cursor.execute("""
        SELECT cat_name, SUM(duration_minutes) AS sleep_minutes
        FROM cat_activities
        WHERE activity_type='sleep' AND DATE(start_time)=CURDATE()
        GROUP BY cat_name
    """)
    sleep_map = {r["cat_name"]: (r["sleep_minutes"] if r["sleep_minutes"] is not None else None)
                 for r in cursor.fetchall()}

    cursor.execute("SELECT name FROM cats")
    for cat in cursor.fetchall():
        name = cat["name"]
        if name in sleep_map and sleep_map[name] is not None:
            mins = sleep_map[name] or 0
            hours = mins / 60
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
    return alerts

def _ingest_alerts_today(cursor):
    """คำนวณและบันทึกลง alerts_log เฉพาะ 'ของวันนี้' (กันซ้ำด้วย UNIQUE INDEX)"""
    new_alerts = _compute_alerts_today(cursor)
    inserted = 0
    for a in new_alerts:
        try:
            cursor.execute("""
                INSERT INTO alerts_log (cat_name, alert_type, message, is_read, created_at)
                VALUES (%s, %s, %s, 0, NOW())
            """, (a["cat"], a["type"], a["message"]))
            inserted += 1
        except mysql.connector.Error:
            # ถ้าซ้ำ (unique) จะ error ก็ปล่อยผ่านเพื่อไม่สะสมซ้ำในวันเดียวกัน
            pass
    return inserted

@app.route("/api/alerts", methods=["GET"])
def list_alerts():
    """ดึงรายการแจ้งเตือน (จะ trigger ingest ของวันนี้ก่อนเสมอ)"""
    cat = request.args.get("cat")  # optional - กรองตามแมว
    include_read = request.args.get("include_read", "1") == "1"  # default รวมที่อ่านแล้ว

    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        _ingest_alerts_today(cursor)
        connection.commit()

        base_sql = """
        SELECT id, cat_name AS cat, alert_type AS type, message, is_read, created_at
        FROM alerts_log
        WHERE 1=1
        AND is_read <> 2          
"""

        params = []
        if cat:
            base_sql += " AND cat_name=%s"
            params.append(cat)
        if not include_read:
            base_sql += " AND is_read=0"
        base_sql += " ORDER BY created_at DESC, id DESC LIMIT 500"

        cursor.execute(base_sql, tuple(params))
        rows = cursor.fetchall()
        return jsonify(rows)
    finally:
        cursor.close()
        connection.close()

@app.route("/api/alerts/mark_read", methods=["PATCH"])
def mark_alerts_read():
    """ทำเครื่องหมายอ่านแล้ว: ส่ง ids=[...]"""
    body = request.json or {}
    ids = body.get("ids") or []
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify({"message": "ids required"}), 400

    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor()
    try:
        q = "UPDATE alerts_log SET is_read=1 WHERE id IN (" + ",".join(["%s"]*len(ids)) + ")"
        cursor.execute(q, tuple(ids))
        connection.commit()
        return jsonify({"updated": cursor.rowcount})
    finally:
        cursor.close()
        connection.close()

@app.route("/api/alerts/mark_all_read", methods=["PATCH"])
def mark_all_read():
    """อ่านทั้งหมด (option: กรองตามแมว)"""
    cat = request.args.get("cat")
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor()
    try:
        if cat:
            cursor.execute("UPDATE alerts_log SET is_read=1 WHERE cat_name=%s AND is_read=0", (cat,))
        else:
            cursor.execute("UPDATE alerts_log SET is_read=1 WHERE is_read=0")
        connection.commit()
        return jsonify({"updated": cursor.rowcount})
    finally:
        cursor.close()
        connection.close()
@app.route("/api/alerts/delete", methods=["DELETE"])
def delete_alerts():
    """Archive (ซ่อน) รายการที่เลือก: ส่ง ids=[...]  -> is_read=2"""
    body = request.json or {}
    ids = body.get("ids") or []
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify({"message": "ids required"}), 400

    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor()
    try:
        q = "UPDATE alerts_log SET is_read=2 WHERE id IN (" + ",".join(["%s"]*len(ids)) + ")"
        cursor.execute(q, tuple(ids))
        connection.commit()
        return jsonify({"deleted": cursor.rowcount})
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
# G) STATISTICS API
# =========================================
from decimal import Decimal

@app.route("/api/statistics/years", methods=["GET"])
def api_statistics_years():
    """
    คืน 'ทุกปี' ที่มีข้อมูลใน cat_activities (เรียง ASC)
    ใช้เติมดรอปดาวน์ทั้ง 'ปีเริ่มต้น' และ 'ปีสิ้นสุด' ในหน้า Statistics
    """
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT DISTINCT YEAR(start_time) AS y
            FROM cat_activities
            WHERE start_time IS NOT NULL
            ORDER BY y ASC
        """)
        years = [int(r["y"]) for r in cursor.fetchall() if r.get("y") is not None]
        return jsonify({"years": years})
    finally:
        cursor.close()
        connection.close()


@app.route("/api/statistics", methods=["GET"])
def api_statistics():
    """
    Query params:
      cat: ชื่อแมว (จำเป็น)
      period: daily | monthly | yearly
      year: ใช้กับ daily/monthly (ปีสิ้นสุด)
      month: ใช้กับ daily (เดือน 01-12)
      start_year, end_year: ใช้กับ yearly (ช่วงปีเริ่ม→ปีสิ้นสุด)
    """
    cat = request.args.get("cat")
    period = (request.args.get("period") or "daily").lower()
    year = request.args.get("year")
    month = request.args.get("month")
    start_year = request.args.get("start_year")
    end_year = request.args.get("end_year") or year

    if not cat:
        return jsonify({"message": "missing cat"}), 400

    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    try:
        # หา min/max ปีใน DB ไว้ fallback ให้เลือกอัตโนมัติ
        cursor.execute("""
            SELECT MIN(YEAR(start_time)) AS miny,
                   MAX(YEAR(start_time)) AS maxy
            FROM cat_activities
            WHERE start_time IS NOT NULL
        """)
        bounds = cursor.fetchone() or {}
        miny = int(bounds["miny"]) if bounds.get("miny") else None
        maxy = int(bounds["maxy"]) if bounds.get("maxy") else None

        labels, sleep_min, eat_cnt, excrete_cnt = [], [], [], []
        total_sleep = Decimal(0)
        total_eat_cnt = 0
        total_excrete = 0

        if period == "daily":
            # รายวัน: รวมต่อวันใน (ปี,เดือน) ที่เลือก (30 จุดฝั่งหน้าเว็บจะ align เอง)
            if not year:
                if maxy:
                    year = str(maxy)
                else:
                    return jsonify({"labels": [], "series": {}, "summary": {}})
            if not month:
                cursor.execute("""
                    SELECT LPAD(MONTH(MAX(start_time)),2,'0') AS m
                    FROM cat_activities
                    WHERE cat_name=%s AND YEAR(start_time)=%s
                """, (cat, year))
                mrow = cursor.fetchone()
                month = (mrow["m"] if mrow and mrow["m"] else "01")

            sql = """
                SELECT DATE(start_time) AS d,
                  SUM(CASE WHEN activity_type='sleep'   THEN COALESCE(duration_minutes,0) ELSE 0 END) AS sleep_min,
                  SUM(CASE WHEN activity_type='eat'     THEN 1 ELSE 0 END) AS eat_count,
                  SUM(CASE WHEN activity_type='excrete' THEN 1 ELSE 0 END) AS excrete_count
                FROM cat_activities
                WHERE cat_name=%s AND YEAR(start_time)=%s AND MONTH(start_time)=%s
                GROUP BY DATE(start_time)
                ORDER BY DATE(start_time)
            """
            cursor.execute(sql, (cat, year, month))
            rows = cursor.fetchall() or []
            for r in rows:
                labels.append(r["d"].strftime("%Y-%m-%d"))
                sl = float(r.get("sleep_min") or 0)
                ea = int(r.get("eat_count") or 0)
                ex = int(r.get("excrete_count") or 0)
                sleep_min.append(sl); eat_cnt.append(ea); excrete_cnt.append(ex)
                total_sleep += Decimal(sl); total_eat_cnt += ea; total_excrete += ex

        elif period == "monthly":
            # รายเดือน: รวมต่อเดือนในปีที่เลือก (12 จุด)
            if not year:
                if maxy:
                    year = str(maxy)
                else:
                    return jsonify({"labels": [], "series": {}, "summary": {}})

            sql = """
                SELECT MONTH(start_time) AS mo,
                  SUM(CASE WHEN activity_type='sleep'   THEN COALESCE(duration_minutes,0) ELSE 0 END) AS sleep_min,
                  SUM(CASE WHEN activity_type='eat'     THEN 1 ELSE 0 END) AS eat_count,
                  SUM(CASE WHEN activity_type='excrete' THEN 1 ELSE 0 END) AS excrete_count
                FROM cat_activities
                WHERE cat_name=%s AND YEAR(start_time)=%s
                GROUP BY MONTH(start_time)
                ORDER BY MONTH(start_time)
            """
            cursor.execute(sql, (cat, year))
            rows = cursor.fetchall() or []
            for r in rows:
                labels.append(f"{int(year):04d}-{int(r['mo']):02d}")
                sl = float(r.get("sleep_min") or 0)
                ea = int(r.get("eat_count") or 0)
                ex = int(r.get("excrete_count") or 0)
                sleep_min.append(sl); eat_cnt.append(ea); excrete_cnt.append(ex)
                total_sleep += Decimal(sl); total_eat_cnt += ea; total_excrete += ex

        else:
            # รายปี: start_year → end_year (inclusive)
            if not end_year and maxy: end_year = str(maxy)
            if not start_year and miny: start_year = str(miny)
            if not start_year or not end_year:
                return jsonify({"labels": [], "series": {}, "summary": {}})

            s_y = int(start_year); e_y = int(end_year)
            if miny is not None: s_y = max(s_y, miny)
            if maxy is not None: e_y = min(e_y, maxy)
            if s_y > e_y: s_y, e_y = e_y, s_y

            sql = """
                SELECT YEAR(start_time) AS y,
                  SUM(CASE WHEN activity_type='sleep'   THEN COALESCE(duration_minutes,0) ELSE 0 END) AS sleep_min,
                  SUM(CASE WHEN activity_type='eat'     THEN 1 ELSE 0 END) AS eat_count,
                  SUM(CASE WHEN activity_type='excrete' THEN 1 ELSE 0 END) AS excrete_count
                FROM cat_activities
                WHERE cat_name=%s AND YEAR(start_time) BETWEEN %s AND %s
                GROUP BY YEAR(start_time)
                ORDER BY YEAR(start_time)
            """
            cursor.execute(sql, (cat, s_y, e_y))
            rows = cursor.fetchall() or []
            for r in rows:
                labels.append(f"{int(r['y']):04d}")
                sl = float(r.get("sleep_min") or 0)
                ea = int(r.get("eat_count") or 0)
                ex = int(r.get("excrete_count") or 0)
                sleep_min.append(sl); eat_cnt.append(ea); excrete_cnt.append(ex)
                total_sleep += Decimal(sl); total_eat_cnt += ea; total_excrete += ex

        return jsonify({
            "labels": labels,
            "series": {
                
                "sleepMinutes": sleep_min,
                "eatCount":     eat_cnt,
                "excreteCount": excrete_cnt,
            },
            "summary": {
                "totalSleepHours": float(total_sleep) / 60.0,
                "totalEatCount":   total_eat_cnt,
                "totalExcreteCount": total_excrete,
            }
        })
    finally:
        cursor.close()
        connection.close()



# =========================================
# MAIN
# =========================================
if __name__ == "__main__":
    app.run(debug=True, port=5000)
