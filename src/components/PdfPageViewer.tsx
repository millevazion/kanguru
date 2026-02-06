import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min?url';

GlobalWorkerOptions.workerSrc = workerSrc;

type PdfPageViewerProps = {
  url: string;
  page: number;
  scale: number;
  onPageCount?: (count: number) => void;
};

export default function PdfPageViewer({ url, page, scale, onPageCount }: PdfPageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    getDocument(url).promise
      .then((loaded) => {
        if (cancelled) return;
        setDoc(loaded);
        onPageCount?.(loaded.numPages);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [url, onPageCount]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    const render = async () => {
      setStatus('loading');
      const pageObj = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pageObj.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await pageObj.render({ canvasContext: context, viewport }).promise;
      if (!cancelled) setStatus('ready');
    };

    render().catch(() => {
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
    };
  }, [doc, page, scale]);

  return (
    <div className="pdf-shell">
      {status === 'error' ? (
        <div className="pdf-error">PDF could not be loaded. Check the file path.</div>
      ) : (
        <canvas ref={canvasRef} className="pdf-canvas" />
      )}
      {status === 'loading' && <div className="pdf-loading">Rendering...</div>}
    </div>
  );
}
