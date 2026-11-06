"""CHUDIN VI SUBTITLE - local Vietnamese TTS worker (VieNeu-TTS v3 Turbo, ONNX/CPU).

Spawned by omp-host.mjs inside the private virtualenv:

    python -I -X utf8 worker.py --home <tts root> --manifest <asset-manifest.json>

Protocol: JSON lines. The host writes one request per line on stdin

    {"op": "synth", "job": 7, "text": "...", "voice": "Hải Đăng"}

and the worker answers on the original stdout with

    {"job": 7, "event": "audio", "seq": 0, "data": "<base64 slice of the WAV>"}   (0..n times)
    {"job": 7, "event": "done", "durationMs": 1234, "bytes": 118478, "chunks": 1, "voice": "Hải Đăng"}
    {"job": 7, "event": "error", "type": "unsupported" | "tts_failed", "message": "..."}

The model loads lazily on the first job. Text is only ever treated as text: it is
never used as a path, a command or a format string. Everything is offline.
"""

import argparse
import base64
import json
import os
import sys
import threading
import time
import unicodedata
import zlib

# ---------------------------------------------------------------------------
# Limits (the host enforces the same ones before a job reaches this process).
# ---------------------------------------------------------------------------
MAX_TEXT_CHARS = 2000
MAX_VOICE_CHARS = 64
MAX_WAV_BYTES = 16 * 1024 * 1024
MAX_DURATION_S = 120.0
SLICE_BYTES = 3 * 49152  # multiple of 3: every base64 slice decodes on its own (196608 chars)
SAMPLE_RATE = 48_000
THREADS = 4
TEMPERATURE = 0.8
PEAK_LIMIT = 0.9


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', required=True)
    parser.add_argument('--manifest', required=True)
    return parser.parse_args()


# Keep the protocol channel clean: anything libraries print goes to stderr.
_protocol = os.fdopen(os.dup(1), 'w', encoding='utf-8', newline='\n')
os.dup2(2, 1)
sys.stdout = sys.stderr
_write_lock = threading.Lock()


def send(message):
    line = json.dumps(message, ensure_ascii=True, separators=(',', ':'))
    with _write_lock:
        _protocol.write(line + '\n')
        _protocol.flush()


def fail(job, kind, message):
    send({'job': job, 'event': 'error', 'type': kind, 'message': str(message)[:400]})


def watch_parent():
    """The host is our parent. If it vanishes (crash / SIGKILL) stop burning CPU."""
    parent = os.getppid()
    while True:
        time.sleep(1.0)
        if os.getppid() != parent:
            os._exit(0)


def block_network():
    def guard(event, args):
        if event in ('socket.connect', 'socket.getaddrinfo'):
            raise RuntimeError('The voice worker is offline-only: ' + event)

    sys.addaudithook(guard)


def clean_text(value):
    if not isinstance(value, str):
        raise ValueError('text must be a string')
    text = unicodedata.normalize('NFC', value)
    text = ''.join(' ' if (unicodedata.category(c) in ('Cc', 'Cf', 'Zl', 'Zp') or c.isspace()) else c for c in text)
    text = ' '.join(text.split())
    if not text:
        raise ValueError('text is empty')
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f'text is longer than {MAX_TEXT_CHARS} characters')
    if not any(c.isalnum() for c in text):
        raise ValueError('text has nothing to read aloud')
    return text


class Engine:
    def __init__(self, home, manifest):
        self.home = home
        self.manifest = manifest
        self.tts = None

    def model_dir(self):
        for repo in self.manifest['repos']:
            if repo['repo'] == 'pnnbao-ump/VieNeu-TTS-v3-Turbo':
                name = 'models--' + repo['repo'].replace('/', '--')
                return os.path.join(self.home, 'huggingface', 'hub', name, 'snapshots', repo['revision'])
        raise RuntimeError('asset manifest has no VieNeu model')

    def load(self):
        if self.tts is not None:
            return self.tts
        from vieneu import Vieneu

        model = self.model_dir()
        self.tts = Vieneu(
            backbone_repo=model,
            onnx_dir=os.path.join(model, 'onnx_update'),
            backend='onnx',
            device='cpu',
            precision='fp32',
            threads=THREADS,
        )
        if getattr(self.tts, 'sample_rate', SAMPLE_RATE) != SAMPLE_RATE:
            raise RuntimeError('unexpected sample rate')
        return self.tts

    def synth(self, job, text, voice):
        import numpy as np

        text = clean_text(text)
        if not isinstance(voice, str) or not voice.strip() or len(voice) > MAX_VOICE_CHARS:
            raise ValueError('voice is invalid')
        tts = self.load()
        name = tts.resolve_voice_name(unicodedata.normalize('NFC', voice.strip()))
        if name is None:
            raise ValueError('voice is not available')
        # Same text + voice -> same audio, so the extension's cache stays consistent.
        np.random.seed(zlib.crc32(f'{name}\n{text}'.encode('utf-8')) & 0xFFFFFFFF)
        audio = np.asarray(tts.infer(text, voice=name, temperature=TEMPERATURE), dtype=np.float32).reshape(-1)
        if audio.size == 0:
            raise ValueError('text has nothing to read aloud')
        if not np.isfinite(audio).all():
            raise RuntimeError('synthesis produced invalid samples')
        peak = float(np.max(np.abs(audio)))
        if peak < 1e-5:
            raise RuntimeError('synthesis produced silence')
        if peak > PEAK_LIMIT:
            audio = audio * (PEAK_LIMIT / peak)
        duration = audio.size / SAMPLE_RATE
        if duration > MAX_DURATION_S:
            raise OverflowError(f'audio is longer than {int(MAX_DURATION_S)} s')
        pcm = np.clip(np.rint(audio * 32767.0), -32768, 32767).astype('<i2').tobytes()
        wav = wav_header(len(pcm)) + pcm
        if len(wav) > MAX_WAV_BYTES:
            raise OverflowError('audio is larger than 16 MiB')
        return name, wav, duration


def wav_header(data_bytes):
    import struct

    return b'RIFF' + struct.pack('<I', 36 + data_bytes) + b'WAVEfmt ' + struct.pack(
        '<IHHIIHH', 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16
    ) + b'data' + struct.pack('<I', data_bytes)


def main():
    args = parse_args()
    with open(args.manifest, encoding='utf-8') as handle:
        manifest = json.load(handle)
    block_network()
    threading.Thread(target=watch_parent, daemon=True).start()
    engine = Engine(os.path.abspath(args.home), manifest)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        job = None
        try:
            request = json.loads(raw)
            job = request.get('job')
            if request.get('op') != 'synth' or not isinstance(job, int):
                raise ValueError('bad request')
            voice_name, wav, duration = engine.synth(job, request.get('text'), request.get('voice'))
            chunks = 0
            for offset in range(0, len(wav), SLICE_BYTES):
                piece = base64.b64encode(wav[offset:offset + SLICE_BYTES]).decode('ascii')
                send({'job': job, 'event': 'audio', 'seq': chunks, 'data': piece})
                chunks += 1
            send({
                'job': job, 'event': 'done', 'durationMs': int(round(duration * 1000)),
                'bytes': len(wav), 'chunks': chunks, 'voice': voice_name,
            })
        except (ValueError, OverflowError) as error:
            fail(job, 'unsupported', error)
        except Exception as error:  # noqa: BLE001 - reported to the host, which resets the worker if needed
            fail(job, 'tts_failed', f'{type(error).__name__}: {error}')


if __name__ == '__main__':
    main()
