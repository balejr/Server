import mediapipe as mp
import cv2
import numpy as np
from PIL import Image
import io

mp_pose = mp.solutions.pose

def analyze_pose(image_data: bytes):
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    image_np = np.array(image)

    with mp_pose.Pose(static_image_mode=True) as pose:
        results = pose.process(cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR))

        if not results.pose_landmarks:
            return {"success": False, "message": "No pose detected"}

        # Example: return coordinates of key landmarks
        keypoints = []
        for id, landmark in enumerate(results.pose_landmarks.landmark):
            keypoints.append({
                "id": id,
                "x": landmark.x,
                "y": landmark.y,
                "z": landmark.z,
                "visibility": landmark.visibility,
            })

        return {"success": True, "keypoints": keypoints}
