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

@app.route('/api/update_config', methods=['POST'])
def update_config():
    data = request.get_json()
    connection = mysql.connector.connect(**db_config)
    cursor = connection.cursor()
    cursor.execute("""
        UPDATE system_config
        SET alert_no_cat = %s, alert_no_excrete = %s, alert_no_sleep = %s, alert_no_eat = %s, max_supported_cats = %s
        WHERE id = 1
    """, (
        data['alert_no_cat'],
        data['alert_no_excrete'],
        data['alert_no_sleep'],
        data['alert_no_eat'],
        data['max_supported_cats']
    ))
    connection.commit()
    cursor.close()
    connection.close()
    return jsonify({'status': 'success'}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)
