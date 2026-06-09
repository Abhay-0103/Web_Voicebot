export const getAudioContextConstructor = () => {
  const windowWithWebkit = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const audioContext = window.AudioContext || windowWithWebkit.webkitAudioContext;
  if (!audioContext) {
    throw new Error('AudioContext is not supported in this browser.');
  }

  return audioContext;
};

const createWavHeader = (dataLength: number, sampleRate: number, numChannels = 1) => {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const blockAlign = numChannels * 2;
  const byteRate = sampleRate * blockAlign;

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  return new Uint8Array(buffer);
};

export const float32ToWavBase64 = (inputData: Float32Array, sampleRate = 16000) => {
  const pcmData = new Int16Array(inputData.length);

  for (let i = 0; i < inputData.length; i += 1) {
    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
  }

  const pcmBytes = new Uint8Array(pcmData.buffer);
  const wavHeader = createWavHeader(pcmBytes.byteLength, sampleRate, 1);
  const wavBytes = new Uint8Array(wavHeader.byteLength + pcmBytes.byteLength);
  wavBytes.set(wavHeader, 0);
  wavBytes.set(pcmBytes, wavHeader.byteLength);

  let binary = '';

  for (let i = 0; i < wavBytes.length; i += 1) {
    binary += String.fromCharCode(wavBytes[i]);
  }

  return btoa(binary);
};

export const base64ToObjectUrl = (base64Audio: string, mimeType = 'audio/wav') => {
  const cleaned = base64Audio.startsWith('data:') ? base64Audio.split(',')[1] : base64Audio;
  const binaryString = atob(cleaned);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const blob = new Blob([bytes.buffer], { type: mimeType });
  return URL.createObjectURL(blob);
};
