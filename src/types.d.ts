export interface ReadAloudOptions {
  volume: number;
  pitch: number;
  rate: number;
  voice: SpeechSynthesisVoice;
}

export interface SimpleServerReadAloudOptions {
  /// Speader id. Default 1
  sid: number;

  /// Default 1.0
  speed: number;

  url?: string;
}

export enum ReadAloudDriver {
  Native,
  SimpleServer,
}
