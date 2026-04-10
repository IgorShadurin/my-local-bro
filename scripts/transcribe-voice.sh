#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <audio-file>" >&2
  exit 2
fi

input_file="$1"
if [[ ! -f "$input_file" ]]; then
  echo "Audio file not found: $input_file" >&2
  exit 2
fi

expand_path() {
  case "$1" in
    \~) printf '%s\n' "$HOME" ;;
    \~/*) printf '%s/%s\n' "$HOME" "${1#\~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

trim_text_file() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text(encoding='utf-8').strip()
if not text:
    raise SystemExit('Whisper returned an empty transcript')
print(text)
PY
}

run_openai_whisper() {
  local whisper_bin model model_dir device beam_size threads language allow_download fp16 out_dir transcript_file model_file

  whisper_bin="${WHISPER_BIN:-whisper}"
  model="${WHISPER_MODEL:-large-v3}"
  model_dir="${WHISPER_MODEL_DIR:-$HOME/.cache/whisper}"
  device="${WHISPER_DEVICE:-auto}"
  beam_size="${WHISPER_BEAM_SIZE:-5}"
  threads="${WHISPER_THREADS:-0}"
  language="${WHISPER_LANGUAGE:-}"
  allow_download="${WHISPER_ALLOW_DOWNLOAD:-false}"
  fp16="${WHISPER_FP16:-False}"
  model_dir="$(expand_path "$model_dir")"

  auto_device() {
    python3 - <<'PY'
try:
    import torch
    if torch.backends.mps.is_available():
        print('mps')
    else:
        print('cpu')
except Exception:
    print('cpu')
PY
  }

  model_file_for() {
    case "$1" in
      tiny|base|small|medium|large|large-v1|large-v2|large-v3|large-v3-turbo|turbo)
        printf '%s/%s.pt\n' "$model_dir" "$1"
        ;;
      *)
        printf '\n'
        ;;
    esac
  }

  if [[ "$device" == "auto" ]]; then
    device="$(auto_device)"
  fi

  model_file="$(model_file_for "$model")"
  if [[ -n "$model_file" && ! -f "$model_file" && "$allow_download" != "true" ]]; then
    echo "Whisper model is not cached: $model_file" >&2
    echo "Set WHISPER_ALLOW_DOWNLOAD=true once to download it, or set WHISPER_MODEL to a cached model." >&2
    exit 1
  fi

  out_dir="$(mktemp -d)"
  trap 'rm -rf "$out_dir"' RETURN

  local args=(
    "$input_file"
    --model "$model"
    --model_dir "$model_dir"
    --device "$device"
    --task transcribe
    --temperature 0
    --beam_size "$beam_size"
    --condition_on_previous_text False
    --fp16 "$fp16"
    --output_format txt
    --output_dir "$out_dir"
    --verbose False
  )

  if [[ "$threads" != "0" ]]; then
    args+=(--threads "$threads")
  fi

  if [[ -n "$language" ]]; then
    args+=(--language "$language")
  fi

  "$whisper_bin" "${args[@]}" >/dev/null
  transcript_file="$(find "$out_dir" -type f -name '*.txt' | head -n 1)"
  if [[ -z "$transcript_file" || ! -f "$transcript_file" ]]; then
    echo "Whisper did not produce a transcript file" >&2
    exit 1
  fi

  trim_text_file "$transcript_file"
}

run_whisper_cpp() {
  local cli model model_dir language threads temp_dir wav_file model_path voiceink_dir output

  cli="${WHISPER_CPP_BIN:-}"
  model="${WHISPER_MODEL:-ggml-large-v3-turbo-q5_0}"
  model_dir="${WHISPER_CPP_MODEL_DIR:-}"
  language="${WHISPER_LANGUAGE:-auto}"
  threads="${WHISPER_CPP_THREADS:-4}"
  voiceink_dir="$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels"

  if [[ -z "$cli" ]]; then
    if command -v whisper-cli >/dev/null 2>&1; then
      cli="$(command -v whisper-cli)"
    elif [[ -x "$HOME/web/whisper.cpp/build/bin/whisper-cli" ]]; then
      cli="$HOME/web/whisper.cpp/build/bin/whisper-cli"
    else
      echo "whisper.cpp CLI not found. Set WHISPER_CPP_BIN." >&2
      exit 1
    fi
  fi
  cli="$(expand_path "$cli")"
  if [[ ! -x "$cli" ]]; then
    echo "whisper.cpp CLI is not executable: $cli" >&2
    exit 1
  fi

  if [[ -z "$model_dir" && -d "$voiceink_dir" ]]; then
    model_dir="$voiceink_dir"
  fi
  if [[ -z "$model_dir" ]]; then
    echo "Whisper.cpp model directory is not set. Set WHISPER_CPP_MODEL_DIR." >&2
    exit 1
  fi
  model_dir="$(expand_path "$model_dir")"
  model_path="$model_dir/$model.bin"
  if [[ ! -f "$model_path" ]]; then
    echo "Whisper.cpp model is not installed: $model_path" >&2
    exit 1
  fi

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' RETURN
  wav_file="$temp_dir/input.wav"

  ffmpeg -y -loglevel error -i "$input_file" -ar 16000 -ac 1 -c:a pcm_s16le "$wav_file"

  output="$("$cli" -m "$model_path" -f "$wav_file" -l "$language" -t "$threads" -np -nt)"
  output="$(printf '%s\n' "$output" | sed '/^[[:space:]]*$/d')"
  if [[ -z "$output" ]]; then
    echo "whisper.cpp returned an empty transcript" >&2
    exit 1
  fi
  printf '%s\n' "$output"
}

case "${WHISPER_MODEL:-}" in
  ggml-*)
    run_whisper_cpp
    ;;
  *)
    run_openai_whisper
    ;;
esac
