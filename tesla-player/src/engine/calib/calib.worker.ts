import { CalCalibration, type CalibRequest } from '@/model/calib';

// the DOM lib types `self` as a window: only these two are used
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; req: CalibRequest }>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (e) => {
  const { id, req } = e.data;
  try {
    scope.postMessage({ id, result: new CalCalibration(req).run() });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
