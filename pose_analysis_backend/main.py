from fastapi import FastAPI, File, UploadFile
from analysis.pose_analysis import analyze_pose

app = FastAPI()

@app.post("/analyze/image")
async def analyze_image(file: UploadFile = File(...)):
    contents = await file.read()
    result = analyze_pose(contents)
    return result
