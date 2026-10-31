/**
 * Google Cloud Text-to-Speech Server-Side Provider
 * Securely calls https://texttospeech.googleapis.com/v1/text:synthesize
 * using the server-side GOOGLE_TTS_API_KEY environment variable.
 */

export const GOOGLE_TTS_PERSONA_VOICES = {
  aria_warm: 'en-US-Neural2-F',
  marcus_calm: 'en-US-Neural2-D',
  elena_soft: 'en-US-Neural2-C',
  devon_clear: 'en-US-Neural2-J',
  zara_bright: 'en-US-Neural2-G',
  kofi_smooth: 'en-US-Neural2-A',
  olivia_quiet: 'en-US-Neural2-E',
  leo_confident: 'en-US-Neural2-I',
  sophia_empathetic: 'en-US-Neural2-H',
  julian_resonant: 'en-US-Wavenet-B',
  chloe_casual: 'en-US-Wavenet-F',
  gabriel_thoughtful: 'en-US-Wavenet-J',
} as const;

export type GoogleTtsPersonaId = keyof typeof GOOGLE_TTS_PERSONA_VOICES;

export interface SynthesisOptions {
  speakingRate?: number;
  pitch?: number;
}

export interface SynthesisResult {
  audioBuffer: Buffer;
  contentType: string;
  voiceName: string;
  personaId: string;
}

export class GoogleTtsProvider {
  private getApiKey(): string | null {
    const key = process.env.GOOGLE_TTS_API_KEY?.trim();
    if (!key || key === 'MY_GOOGLE_TTS_API_KEY' || key.length < 5) {
      return null;
    }
    return key;
  }

  public isConfigured(): boolean {
    return this.getApiKey() !== null;
  }

  public getVoiceForPersona(personaId: string): string {
    if (!Object.prototype.hasOwnProperty.call(GOOGLE_TTS_PERSONA_VOICES, personaId)) {
      throw new Error(`Unsupported persona "${personaId}". Must be one of: ${Object.keys(GOOGLE_TTS_PERSONA_VOICES).join(', ')}`);
    }
    return GOOGLE_TTS_PERSONA_VOICES[personaId as GoogleTtsPersonaId];
  }

  public async synthesize(
    text: string,
    personaId: string,
    options?: SynthesisOptions
  ): Promise<SynthesisResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const err = new Error('Google Cloud Text-to-Speech is unconfigured. Set GOOGLE_TTS_API_KEY in environment.');
      (err as any).statusCode = 503;
      throw err;
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      const err = new Error('Text to synthesize is required and cannot be empty.');
      (err as any).statusCode = 400;
      throw err;
    }

    const trimmedText = text.trim();
    if (trimmedText.length > 5000) {
      const err = new Error('Text exceeds maximum synthesis length of 5000 characters.');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!Object.prototype.hasOwnProperty.call(GOOGLE_TTS_PERSONA_VOICES, personaId)) {
      const err = new Error(`Unsupported persona "${personaId}". Must be one of: ${Object.keys(GOOGLE_TTS_PERSONA_VOICES).join(', ')}`);
      (err as any).statusCode = 400;
      throw err;
    }

    const voiceName = GOOGLE_TTS_PERSONA_VOICES[personaId as GoogleTtsPersonaId];

    // Compute clamped speaking rate (0.25 to 4.0) and pitch (-20.0 to 20.0 semitones)
    let speakingRate = 1.0;
    if (typeof options?.speakingRate === 'number' && Number.isFinite(options.speakingRate)) {
      speakingRate = Math.max(0.25, Math.min(4.0, options.speakingRate));
    }

    let pitch = 0.0;
    if (typeof options?.pitch === 'number' && Number.isFinite(options.pitch)) {
      pitch = Math.max(-20.0, Math.min(20.0, options.pitch));
    }

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
    const requestBody = {
      input: { text: trimmedText },
      voice: {
        languageCode: 'en-US',
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate,
        pitch,
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Client': 'rare-engine/1.0',
        },
        body: JSON.stringify(requestBody),
      });
    } catch (networkErr: any) {
      const err = new Error(`Failed to reach Google Cloud Text-to-Speech service: ${networkErr?.message || 'Network error'}`);
      (err as any).statusCode = 502;
      throw err;
    }

    if (!response.ok) {
      let errorMessage = `Google Cloud Text-to-Speech API returned status ${response.status}`;
      try {
        const errorJson = await response.json();
        if (errorJson?.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch {}
      const err = new Error(errorMessage);
      (err as any).statusCode = response.status >= 500 ? 502 : response.status;
      throw err;
    }

    const data = await response.json().catch(() => null);
    if (!data?.audioContent || typeof data.audioContent !== 'string') {
      const err = new Error('Google Cloud Text-to-Speech response did not contain audioContent.');
      (err as any).statusCode = 502;
      throw err;
    }

    const audioBuffer = Buffer.from(data.audioContent, 'base64');
    return {
      audioBuffer,
      contentType: 'audio/mpeg',
      voiceName,
      personaId,
    };
  }
}

export const googleTtsProvider = new GoogleTtsProvider();
