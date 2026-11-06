// 추론이 화면을 멈추지 않도록 워커에서 실행한다.
import { removeBackground } from "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

// 메시지가 동시에 와도 한 번에 한 장만 처리한다.
let queue = Promise.resolve();

const hasWebGPU = async () => {
  try {
    return Boolean(await navigator.gpu?.requestAdapter());
  } catch {
    return false;
  }
};

async function run({ id, file, model }) {
  const progress = (key, current, total) => {
    self.postMessage({ id, type: "progress", key, current, total });
  };
  const options = { model, progress, output: { format: "image/png" } };

  if (await hasWebGPU()) {
    try {
      return await removeBackground(file, { ...options, device: "gpu" });
    } catch (error) {
      console.warn("WebGPU 실패, CPU로 다시 시도합니다.", error);
    }
  }
  return removeBackground(file, { ...options, device: "cpu" });
}

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const blob = await run(data);
      self.postMessage({ id: data.id, type: "done", blob });
    } catch (error) {
      self.postMessage({ id: data.id, type: "error", message: String(error?.message ?? error) });
    }
  });
};
