import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultImg, setResultImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to access camera');
    }
  }

  function snapshotBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!videoRef.current || !canvasRef.current) return reject('No video');
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('No ctx');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return reject('No blob');
        resolve(blob);
      }, 'image/jpeg', 0.9);
    });
  }

  async function analyze(blob: Blob) {
    setBusy(true);
    setError(null);
    setResultImg(null);
    try {
      const form = new FormData();
      form.append('image', blob, 'frame.jpg');
      const res = await fetch('/api/reconstruct', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data?.reconstructed_base64) {
        setResultImg(`data:image/jpeg;base64,${data.reconstructed_base64}`);
      }
      if (data?.analysis) {
        console.log('DeepFace analysis:', data.analysis);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to analyze');
    } finally {
      setBusy(false);
    }
  }

  async function captureAndAnalyze() {
    try {
      const blob = await snapshotBlob();
      await analyze(blob);
    } catch (e: any) {
      setError(e?.message || 'Capture failed');
    }
  }

  async function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    await analyze(f);
  }

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>AI Forensic Face Reconstruction</h1>
      <p>Upload a photo or use your webcam. The server reconstructs blurred/partial faces with OpenCV + DeepFace.</p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <video ref={videoRef} width={320} height={240} style={{ background: '#000', borderRadius: 8 }} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={startCamera} disabled={streaming}>Start Camera</button>
            <button onClick={captureAndAnalyze} disabled={!streaming || busy}>{busy ? 'Analyzing?' : 'Capture & Analyze'}</button>
          </div>
        </div>

        <div>
          <input type="file" accept="image/*" onChange={onFileInput} />
          {resultImg && (
            <div style={{ marginTop: 12 }}>
              <h3>Reconstructed</h3>
              <img src={resultImg} alt="reconstructed" style={{ maxWidth: 480, borderRadius: 8, border: '1px solid #ddd' }} />
            </div>
          )}
          {error && (
            <p style={{ color: 'red' }}>{error}</p>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </main>
  );
}
