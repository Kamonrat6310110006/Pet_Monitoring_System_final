from flask import Flask, Response, jsonify, request
from flask_cors import CORS
import mysql.connector
import cv2

app = Flask(__name__)
CORS(app)

# --- RTSP Config ---
RTSP_URL = "rtsp://admin:05032544@192.168.22.94:10554/tcp/av0_0"

# MJPEG streaming
def generate_frames():
    cap = cv2.VideoCapture(RTSP_URL)
    if not cap.isOpened():
        print("❌ ไม่สามารถเชื่อมต่อกล้อง RTSP ได้")
        return

    while True:
        success, frame = cap.read()
        if not success:
            break

        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

    cap.release()

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': 'root',
    'database': 'pet_monitoring'
}

# --- GET System Config ---
@app.route('/api/system_config', methods=['GET'])
def get_system_config():
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    query = "SELECT * FROM system_config WHERE id = %s"
    cursor.execute(query, (1,))
    config = cursor.fetchone()
    cursor.close()
    connection.close()
    if config:
        return jsonify(config)
    else:
        return jsonify({"message": "Error fetching system config"}), 500

# --- POST System Config ---
@app.route('/api/system_config', methods=['POST'])
def update_system_config():
    new_config = request.json
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor()
    query = """
        UPDATE system_config 
        SET alertNoCat = %s, alertNoEating = %s, minExcretion = %s, 
            maxExcretion = %s, minSleep = %s, maxSleep = %s, maxCats = %s 
        WHERE id = %s
    """
    cursor.execute(query, (
        new_config['alertNoCat'], 
        new_config['alertNoEating'],
        new_config['minExcretion'],
        new_config['maxExcretion'],
        new_config['minSleep'],
        new_config['maxSleep'],
        new_config['maxCats'],
        2  # อัปเดตค่า id = 2
    ))

    connection.commit()
    cursor.close()
    connection.close()
    
    return jsonify({"message": "Config updated successfully"})

# --- รีเซ็ทการตั้งค่ากลับไปที่ค่าเริ่มต้น ---
@app.route('/api/system_config/reset', methods=['POST'])
def reset_system_config():
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
    
    # ดึงการตั้งค่าเริ่มต้นจาก id = 1
    cursor.execute("SELECT * FROM system_config WHERE id = %s", (1,))
    default_config = cursor.fetchone()
    
    if default_config:
        # อัปเดตค่าการตั้งค่าที่ id = 2 ให้เป็นค่าเริ่มต้น
        update_query = """
            UPDATE system_config
            SET alertNoCat = %s, alertNoEating = %s, minExcretion = %s, 
                maxExcretion = %s, minSleep = %s, maxSleep = %s, maxCats = %s
            WHERE id = %s
        """
        cursor.execute(update_query, (
            default_config['alertNoCat'],
            default_config['alertNoEating'],
            default_config['minExcretion'],
            default_config['maxExcretion'],
            default_config['minSleep'],
            default_config['maxSleep'],
            default_config['maxCats'],
            2  # อัปเดต id = 2
        ))
        connection.commit()
        cursor.close()
        connection.close()
        return jsonify({"message": "System config has been reset to default values"})
    else:
        return jsonify({"message": "Error resetting system config"}), 500


# --- Endpoint สำหรับข้อมูลแมว ---
@app.route('/api/cats', methods=['GET'])
def get_cats():
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
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
    cursor.close()
    connection.close()
    return jsonify(results)

# --- Endpoint สำหรับกิจกรรมแมว ---
@app.route('/api/cat_activities', methods=['GET'])
def get_cat_activities():
    cat_name = request.args.get('cat_name')
    start = request.args.get('start_date')
    end = request.args.get('end_date')
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor(dictionary=True)
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
    cursor.close()
    connection.close()
    return jsonify(results)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
