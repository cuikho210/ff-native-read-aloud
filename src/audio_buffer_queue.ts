export class AudioBufferQueue {
  private context: AudioContext;
  private queue: AudioBuffer[] = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;

  constructor(context?: AudioContext) {
    this.context = context || new AudioContext();
  }

  async enqueue(data: AudioBuffer | ArrayBuffer) {
    let buffer: AudioBuffer;

    if (data instanceof AudioBuffer) {
      buffer = data;
    } else {
      buffer = await this.context.decodeAudioData(data);
    }

    this.queue.push(buffer);

    if (!this.isPlaying) {
      this.playNext();
    }
  }

  private playNext() {
    const buffer = this.queue.shift();
    if (!buffer) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start();

    this.currentSource = source;

    source.onended = () => {
      this.currentSource = null;
      this.playNext();
    };
  }

  stop() {
    if (this.currentSource) {
      this.currentSource.onended = null;
      this.currentSource.stop();
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    this.queue = [];
    this.isPlaying = false;
  }
}
