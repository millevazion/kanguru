import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min?url';

GlobalWorkerOptions.workerSrc = workerSrc;

type QuestionCardProps = {
  url: string;
  page: number;
  questionId: string;
  questionIdsOnPage: string[];
  nextQuestionId?: string;
  scale: number;
};

type Status = 'loading' | 'ready' | 'error';

const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();

type LineItem = { text: string; x: number; y: number };
type Line = { y: number; items: LineItem[] };
type Position = { id: string; x: number; y: number };

export default function QuestionCard({ url, page, questionId, questionIdsOnPage, nextQuestionId, scale }: QuestionCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const pageCacheRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    getDocument(url).promise
      .then((loaded) => {
        if (cancelled) return;
        setDoc(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    const render = async () => {
      setStatus('loading');
      const cachedPage = pageCacheRef.current.get(questionId);
      const candidatePages = cachedPage ? [cachedPage] : [page, ...Array.from({ length: doc.numPages }, (_, i) => i + 1)];

      const findYOnPage = async (pageNumber: number) => {
        const pageObj = await doc.getPage(pageNumber);
        const viewport = pageObj.getViewport({ scale });
        const textContent = await pageObj.getTextContent();
        const items: LineItem[] = [];
        for (const item of textContent.items) {
          if (!('str' in item)) continue;
          const raw = item.str?.trim();
          if (!raw) continue;
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          items.push({ text: raw, x, y });
        }

        const lines: Line[] = [];
        const lineTolerance = 4;
        for (const item of items) {
          const existing = lines.find((line) => Math.abs(line.y - item.y) <= lineTolerance);
          if (existing) {
            existing.items.push(item);
            existing.y = (existing.y + item.y) / 2;
          } else {
            lines.push({ y: item.y, items: [item] });
          }
        }

        const idSet = new Set(questionIdsOnPage.map(normalize));
        const positionsMap = new Map<string, Position>();
        const labelRegex = /([ABC]\s*10|[ABC]\s*[1-9])/g;

        for (const line of lines) {
          const sorted = [...line.items].sort((a, b) => a.x - b.x);
          let lineText = '';
          let lastX = sorted[0]?.x ?? 0;
          for (const piece of sorted) {
            if (piece.x - lastX > 8) lineText += ' ';
            lineText += piece.text;
            lastX = piece.x;
          }
          const cleaned = lineText.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
          const matches = cleaned.matchAll(labelRegex);
          for (const match of matches) {
            const id = match[0].replace(/\s+/g, '');
            if (!idSet.has(normalize(id))) continue;
            if (!positionsMap.has(id)) {
              const minX = sorted[0]?.x ?? 0;
              positionsMap.set(id, { id, x: minX, y: line.y });
            }
          }
        }

        if (positionsMap.size === 0) {
          const fallbackFind = (targetId?: string) => {
            if (!targetId) return null;
            const target = normalize(targetId);
            for (const item of textContent.items) {
              const text = normalize('str' in item ? item.str : '');
              if (!text) continue;
              if (text === target || text.includes(target)) {
                const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
                return { x, y };
              }
            }
            return null;
          };

          for (const id of questionIdsOnPage) {
            const fallback = fallbackFind(id);
            if (fallback) positionsMap.set(id, { id, x: fallback.x, y: fallback.y });
          }
        }

        const positions = questionIdsOnPage
          .map((id) => positionsMap.get(id))
          .filter(Boolean) as Position[];

        return {
          pageObj,
          viewport,
          textContent,
          positions,
          currentPos: positionsMap.get(questionId) ?? null,
          nextPos: nextQuestionId ? positionsMap.get(nextQuestionId) ?? null : null
        };
      };

      let resolved: Awaited<ReturnType<typeof findYOnPage>> | null = null;

      for (const pageNumber of candidatePages) {
        const result = await findYOnPage(pageNumber);
        if (result.currentPos !== null) {
          resolved = result;
          pageCacheRef.current.set(questionId, pageNumber);
          break;
        }
      }

      if (!resolved) {
        const fallback = await findYOnPage(page);
        resolved = fallback;
      }

      const { pageObj, viewport, currentPos, positions } = resolved;
      const paddingTop = 24;
      const paddingBottom = 16;
      const hasCurrent = currentPos !== null;
      const currentY = currentPos?.y ?? 0;
      const currentX = currentPos?.x ?? null;
      const top = hasCurrent ? Math.max(0, currentY - paddingTop) : 0;

      const columnTolerance = 80;
      const sortedByX = [...positions].sort((a, b) => a.x - b.x);
      const clusters: { center: number; items: Position[] }[] = [];
      for (const pos of sortedByX) {
        const last = clusters[clusters.length - 1];
        if (!last || Math.abs(pos.x - last.center) > columnTolerance) {
          clusters.push({ center: pos.x, items: [pos] });
        } else {
          last.items.push(pos);
          last.center = last.items.reduce((sum, item) => sum + item.x, 0) / last.items.length;
        }
      }

      const centers = clusters.map((cluster) => cluster.center).sort((a, b) => a - b);
      const getColumnBounds = (x: number | null) => {
        if (centers.length === 0 || x === null) {
          return { left: 0, right: viewport.width, items: positions };
        }
        let idx = 0;
        let best = Number.POSITIVE_INFINITY;
        centers.forEach((center, index) => {
          const dist = Math.abs(center - x);
          if (dist < best) {
            best = dist;
            idx = index;
          }
        });
        const leftBoundary = idx === 0 ? 0 : (centers[idx - 1] + centers[idx]) / 2;
        const rightBoundary = idx === centers.length - 1 ? viewport.width : (centers[idx] + centers[idx + 1]) / 2;
        const items = clusters.find((cluster) => Math.abs(cluster.center - centers[idx]) < 0.5)?.items ?? positions;
        return { left: leftBoundary, right: rightBoundary, items };
      };

      const { left, right, items: columnItems } = getColumnBounds(currentX);
      const columnPositions = [...columnItems].sort((a, b) => a.y - b.y);
      const currentIndex = columnPositions.findIndex((pos) => pos.id === questionId);
      const nextPos = columnPositions.find((pos, index) => index > currentIndex && pos.y > currentY + 4) ?? null;
      const prevPos = currentIndex > 0 ? columnPositions[currentIndex - 1] : null;

      let bottom = nextPos ? Math.max(top + 140, nextPos.y - paddingBottom) : viewport.height;
      if (!nextPos && hasCurrent) {
        const gaps: number[] = [];
        for (let i = 1; i < columnPositions.length; i += 1) {
          const gap = columnPositions[i].y - columnPositions[i - 1].y;
          if (gap > 24) gaps.push(gap);
        }
        const sortedGaps = gaps.sort((a, b) => a - b);
        const medianGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : null;
        const estimated = medianGap ?? (prevPos ? currentY - prevPos.y : viewport.height * 0.25);
        const maxHeight = viewport.height * 0.55;
        bottom = Math.min(viewport.height, currentY + Math.min(maxHeight, Math.max(220, estimated * 1.35)));
      }

      let cropHeight = Math.min(viewport.height - top, Math.max(200, bottom - top));
      const paddingX = 18;
      let cropLeft = Math.max(0, left - paddingX);
      let cropRight = Math.min(viewport.width, right + paddingX);
      let cropWidth = Math.max(140, cropRight - cropLeft);

      if (!hasCurrent) {
        cropLeft = 0;
        cropRight = viewport.width;
        cropWidth = viewport.width;
        cropHeight = viewport.height;
      }

      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = viewport.width;
      renderCanvas.height = viewport.height;
      const renderContext = renderCanvas.getContext('2d');
      if (!renderContext) return;

      await pageObj.render({ canvasContext: renderContext, viewport }).promise;

      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = cropWidth;
      canvas.height = cropHeight;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(renderCanvas, cropLeft, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      setStatus('ready');
    };

    render().catch(() => {
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
    };
  }, [doc, page, scale, questionId, nextQuestionId, questionIdsOnPage]);

  return (
    <div className="question-card">
      {status === 'error' ? (
        <div className="pdf-error">Question preview could not be loaded.</div>
      ) : (
        <canvas ref={canvasRef} />
      )}
      {status === 'loading' && <div className="pdf-loading">Loading question...</div>}
    </div>
  );
}
