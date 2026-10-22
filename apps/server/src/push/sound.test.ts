import { describe, expect, it } from 'vitest';
import { detectAudio, soundPath } from './sound.ts';

const bytes = (head: string, pad = 16) => new Uint8Array([...head].map((c) => c.charCodeAt(0)).concat(Array(pad).fill(0)));

describe('detectAudio', () => {
  it('recognizes common audio containers by their header', () => {
    expect(detectAudio(bytes('ID3\x04'))).toBe('mp3');
    expect(detectAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...Array(12).fill(0)]))).toBe('mp3');
    expect(detectAudio(bytes('RIFF\x00\x00\x00\x00WAVE'))).toBe('wav');
    expect(detectAudio(bytes('FORM\x00\x00\x00\x00AIFF'))).toBe('aiff');
    expect(detectAudio(bytes('\x00\x00\x00\x20ftypM4A '))).toBe('m4a');
    expect(detectAudio(bytes('caff'))).toBe('caf');
  });

  it('rejects anything else, whatever it is named', () => {
    expect(detectAudio(bytes('<html><script>'))).toBeNull();
    expect(detectAudio(bytes('#!/bin/sh\nrm'))).toBeNull();
    expect(detectAudio(new Uint8Array([1, 2]))).toBeNull();
  });
});

describe('soundPath', () => {
  it('only resolves known system sounds and well-formed custom file names', () => {
    expect(soundPath('default', null)).toBeNull();
    expect(soundPath('system:../../etc/passwd', null)).toBeNull();
    expect(soundPath('custom', '../secret.mp3')).toBeNull();
    expect(soundPath('custom', 'user-1.exe')).toBeNull();
  });
});
