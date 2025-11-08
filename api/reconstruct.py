#!/usr/bin/env python3
import sys
import json
import base64
import cv2
import numpy as np
from io import BytesIO

try:
    from deepface import DeepFace
except Exception:
    DeepFace = None


def read_image(path: str) -> np.ndarray:
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        img = cv2.imread(path)
    if img is None:
        raise RuntimeError('Failed to read image')
    return img


def to_base64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise RuntimeError('Failed to encode image')
    return base64.b64encode(buf.tobytes()).decode('utf-8')


def enhance_image(bgr: np.ndarray) -> np.ndarray:
    # Convert to YCrCb and apply CLAHE on Y channel
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    y, cr, cb = cv2.split(ycrcb)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    y = clahe.apply(y)
    ycrcb = cv2.merge([y, cr, cb])
    enhanced = cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)

    # Denoise
    enhanced = cv2.fastNlMeansDenoisingColored(enhanced, None, 5, 5, 7, 21)

    # Unsharp mask
    gaussian = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=1.2, sigmaY=1.2)
    sharpened = cv2.addWeighted(enhanced, 1.6, gaussian, -0.6, 0)

    # Upscale (simple SR substitute)
    h, w = sharpened.shape[:2]
    scale = 2 if max(h, w) < 800 else 1
    if scale > 1:
        sharpened = cv2.resize(sharpened, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)

    return sharpened


def inpaint_mask(img: np.ndarray) -> np.ndarray:
    # Create a soft mask of very blurred/low-contrast regions for light inpainting
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    lap_abs = np.uint8(np.absolute(lap))
    _, mask = cv2.threshold(lap_abs, 10, 255, cv2.THRESH_BINARY_INV)
    mask = cv2.medianBlur(mask, 5)
    return mask


def reconstruct_face(bgr: np.ndarray) -> (np.ndarray, dict):
    face_crop = None
    analysis = None

    if DeepFace is not None:
        try:
            # extract aligned faces; pick the largest
            faces = DeepFace.extract_faces(img_path=bgr, detector_backend='retinaface', enforce_detection=False)
            if faces:
                faces_sorted = sorted(faces, key=lambda f: f.get('face_confidence', 0), reverse=True)
                face = faces_sorted[0]
                face_crop = (face['face'] * 255).astype('uint8')
        except Exception:
            face_crop = None

        try:
            analysis = DeepFace.analyze(bgr, actions=['age','gender','emotion'], enforce_detection=False)
        except Exception:
            analysis = None

    # If no face crop, operate on full image
    target = face_crop if face_crop is not None else bgr

    # Enhance
    enhanced = enhance_image(target)

    # Light inpainting to fill flat/blurred regions
    try:
        mask = inpaint_mask(enhanced)
        enhanced = cv2.inpaint(enhanced, mask, 3, cv2.INPAINT_TELEA)
    except Exception:
        pass

    return enhanced, (analysis or {})


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: reconstruct.py <image_path>"}))
        sys.exit(1)

    path = sys.argv[1]
    try:
        bgr = read_image(path)
        reconstructed, analysis = reconstruct_face(bgr)
        out = {
            'reconstructed_base64': to_base64(reconstructed),
            'analysis': analysis,
        }
        print(json.dumps(out))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(2)


if __name__ == '__main__':
    main()
