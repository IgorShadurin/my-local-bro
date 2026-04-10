#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${SHORTS_ROOT_DIR:-$SCRIPT_DIR}"
CATEGORY="${2:-}"
DB_PATH="${SHORTS_DB_PATH:-$ROOT_DIR/shorts.sqlite3}"
COUNTER_FILE_NAME="${SHORTS_COUNTER_FILE_NAME:-.counter}"
DATE_OVERRIDE="${SHORTS_DATE_OVERRIDE:-}"
YT_DLP_BIN="${YT_DLP_BIN:-$(command -v yt-dlp || true)}"
FFMPEG_BIN="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
FFPROBE_BIN="${FFPROBE_BIN:-$(command -v ffprobe || true)}"
SQLITE3_BIN="${SQLITE3_BIN:-$(command -v sqlite3 || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
SHORTS_ENABLE_CONVERSION_RAW="${SHORTS_ENABLE_CONVERSION:-false}"
SHORTS_COOKIES_FILE="${SHORTS_COOKIES_FILE:-~/Movies/ShortsToProcess/cookies/instagram-cookies.txt}"
SHORTS_COOKIES_FROM_BROWSER="${SHORTS_COOKIES_FROM_BROWSER:-}"
SHORTS_COOKIES_TIMEOUT_SECONDS="${SHORTS_COOKIES_TIMEOUT_SECONDS:-8}"
COOKIES_WARNING_EMITTED=false

expand_home() {
  local value="$1"
  case "$value" in
    '~')
      printf '%s\n' "$HOME"
      ;;
    '~/'*)
      printf '%s%s\n' "$HOME" "${value:1}"
      ;;
    *)
      printf '%s\n' "$value"
      ;;
  esac
}

ROOT_DIR="$(expand_home "$ROOT_DIR")"
DB_PATH="$(expand_home "$DB_PATH")"
YT_DLP_BIN="$(expand_home "$YT_DLP_BIN")"
FFMPEG_BIN="$(expand_home "$FFMPEG_BIN")"
FFPROBE_BIN="$(expand_home "$FFPROBE_BIN")"
SQLITE3_BIN="$(expand_home "$SQLITE3_BIN")"
NODE_BIN="$(expand_home "$NODE_BIN")"
SHORTS_COOKIES_FILE="$(expand_home "$SHORTS_COOKIES_FILE")"

require_bin() {
  local path="$1"
  local label="$2"
  if [[ -z "$path" || ! -x "$path" ]]; then
    echo "Missing required binary for $label: $path" >&2
    exit 1
  fi
}

is_truthy() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

usage() {
  cat <<USAGE
Usage: $0 <url> [category]

category is optional. Supported values:
  hook
  other
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

URL="$1"
if [[ -z "$URL" ]]; then
  echo "url must be a non-empty string" >&2
  exit 1
fi

CATEGORY="$(printf '%s' "$CATEGORY" | tr '[:upper:]' '[:lower:]')"
if [[ -n "$CATEGORY" && "$CATEGORY" != "hook" && "$CATEGORY" != "other" ]]; then
  echo "Unsupported category: $CATEGORY" >&2
  exit 1
fi

require_bin "$YT_DLP_BIN" 'yt-dlp'
require_bin "$SQLITE3_BIN" 'sqlite3'
require_bin "$NODE_BIN" 'node'

ENABLE_CONVERSION=false
if is_truthy "$SHORTS_ENABLE_CONVERSION_RAW"; then
  ENABLE_CONVERSION=true
  require_bin "$FFMPEG_BIN" 'ffmpeg'
fi

mkdir -p "$ROOT_DIR"
mkdir -p "$(dirname "$DB_PATH")"

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

db_exec() {
  "$SQLITE3_BIN" "$DB_PATH" "$1"
}

db_query() {
  "$SQLITE3_BIN" -batch -noheader "$DB_PATH" "$1"
}

db_query_sep() {
  local separator="$1"
  local query="$2"
  "$SQLITE3_BIN" -batch -noheader -separator "$separator" "$DB_PATH" "$query"
}

init_db() {
  db_exec "
    CREATE TABLE IF NOT EXISTS media_files (
      media_id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      resolved_url TEXT,
      title TEXT,
      author TEXT,
      platform TEXT,
      category TEXT,
      parent_dir TEXT NOT NULL,
      slot TEXT NOT NULL,
      dir_path TEXT NOT NULL,
      original_path TEXT NOT NULL,
      converted_path TEXT NOT NULL,
      original_size_bytes INTEGER,
      converted_size_bytes INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  "
}

current_date_parts() {
  if [[ -n "$DATE_OVERRIDE" ]]; then
    printf '%s\n' "$DATE_OVERRIDE"
    return
  fi
  date '+%Y-%m-%d'
}

month_name_from_number() {
  case "$1" in
    01) printf 'January\n' ;;
    02) printf 'February\n' ;;
    03) printf 'March\n' ;;
    04) printf 'April\n' ;;
    05) printf 'May\n' ;;
    06) printf 'June\n' ;;
    07) printf 'July\n' ;;
    08) printf 'August\n' ;;
    09) printf 'September\n' ;;
    10) printf 'October\n' ;;
    11) printf 'November\n' ;;
    12) printf 'December\n' ;;
    *) echo "Invalid month number: $1" >&2; exit 1 ;;
  esac
}

build_parent_dir() {
  if [[ "$CATEGORY" == "hook" ]]; then
    printf '%s/hook\n' "$ROOT_DIR"
    return
  fi
  if [[ "$CATEGORY" == "other" ]]; then
    printf '%s/other\n' "$ROOT_DIR"
    return
  fi
  local date_parts
  date_parts="$(current_date_parts)"
  local year="${date_parts%%-*}"
  local rest="${date_parts#*-}"
  local month_num="${rest%%-*}"
  local day="${date_parts##*-}"
  local month_name
  month_name="$(month_name_from_number "$month_num")"
  printf '%s/%s/%s/%s\n' "$ROOT_DIR" "$year" "$month_name" "$day"
}

find_slot_dir_by_prefix() {
  local parent_dir="$1"
  local slot="$2"
  find "$parent_dir" -maxdepth 1 -mindepth 1 -type d -name "${slot}*" | sort | head -n 1
}

scan_max_slot() {
  local parent_dir="$1"
  local max=0
  while IFS= read -r dir_path; do
    local base_name
    base_name="$(basename "$dir_path")"
    if [[ "$base_name" =~ ^([0-9]{3}) ]]; then
      local value="${BASH_REMATCH[1]}"
      value=$((10#$value))
      if (( value > max )); then
        max=$value
      fi
    fi
  done < <(find "$parent_dir" -maxdepth 1 -mindepth 1 -type d | sort)
  printf '%s\n' "$max"
}

ensure_counter_file() {
  local parent_dir="$1"
  local counter_file="$parent_dir/$COUNTER_FILE_NAME"
  if [[ -f "$counter_file" ]]; then
    return
  fi
  local max_slot
  max_slot="$(scan_max_slot "$parent_dir")"
  printf '%d\n' $((max_slot + 1)) > "$counter_file"
}

allocate_slot() {
  local parent_dir="$1"
  local counter_file="$parent_dir/$COUNTER_FILE_NAME"
  ensure_counter_file "$parent_dir"
  local next
  next="$(cat "$counter_file")"
  if ! [[ "$next" =~ ^[0-9]+$ ]]; then
    next=1
  fi
  while :; do
    local slot
    slot="$(printf '%03d' "$next")"
    if [[ -z "$(find_slot_dir_by_prefix "$parent_dir" "$slot")" ]]; then
      printf '%d\n' $((next + 1)) > "$counter_file"
      printf '%s\n' "$slot"
      return
    fi
    next=$((next + 1))
  done
}

stat_size() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    printf '0\n'
    return
  fi
  stat -f '%z' "$path"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  "$NODE_BIN" - "$timeout_seconds" "$@" <<'NODE'
const { spawn } = require('node:child_process');
const timeoutSeconds = Number(process.argv[2]);
const cmd = process.argv[3];
const args = process.argv.slice(4);
const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
let killed = false;
const timer = setTimeout(() => {
  killed = true;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 1500);
}, timeoutSeconds * 1000);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (killed || signal) process.exit(124);
  process.exit(code ?? 1);
});
NODE
}

should_try_browser_cookies() {
  local url="$1"
  [[ -n "$SHORTS_COOKIES_FROM_BROWSER" && "$url" == *"instagram.com"* ]]
}

should_try_cookies_file() {
  [[ -n "$SHORTS_COOKIES_FILE" && -f "$SHORTS_COOKIES_FILE" ]]
}

emit_warning_once() {
  local message="$1"
  if [[ "$COOKIES_WARNING_EMITTED" == true ]]; then
    return
  fi
  COOKIES_WARNING_EMITTED=true
  printf '%s\n' "$message" >&2
}

run_ytdlp_capture() {
  local stdout_file stderr_file rc
  stdout_file="$(mktemp)"
  stderr_file="$(mktemp)"

  if should_try_cookies_file; then
    "$YT_DLP_BIN" --cookies "$SHORTS_COOKIES_FILE" "$@" >"$stdout_file" 2>"$stderr_file"
    rc=$?
    if [[ $rc -eq 0 ]]; then
      cat "$stdout_file"
      rm -f "$stdout_file" "$stderr_file"
      return 0
    fi
    emit_warning_once "Warning: cookies file failed; retrying without cookies"
  fi

  if should_try_browser_cookies "$URL"; then
    run_with_timeout "$SHORTS_COOKIES_TIMEOUT_SECONDS" "$YT_DLP_BIN" --cookies-from-browser "$SHORTS_COOKIES_FROM_BROWSER" "$@" >"$stdout_file" 2>"$stderr_file"
    rc=$?
    if [[ $rc -eq 0 ]]; then
      cat "$stdout_file"
      rm -f "$stdout_file" "$stderr_file"
      return 0
    fi
    if [[ $rc -eq 124 ]]; then
      emit_warning_once "Warning: browser cookies from $SHORTS_COOKIES_FROM_BROWSER timed out; retrying without browser cookies"
    fi
  fi

  "$YT_DLP_BIN" "$@" >"$stdout_file" 2>"$stderr_file"
  rc=$?
  if [[ $rc -eq 0 ]]; then
    cat "$stdout_file"
    rm -f "$stdout_file" "$stderr_file"
    return 0
  fi

  cat "$stderr_file" >&2
  rm -f "$stdout_file" "$stderr_file"
  return $rc
}

human_size() {
  local bytes="$1"
  awk -v bytes="$bytes" '
    function fmt(value, unit) {
      if (value >= 100 || value == int(value)) {
        return sprintf("%.0f %s", value, unit)
      }
      if (value >= 10) {
        return sprintf("%.1f %s", value, unit)
      }
      return sprintf("%.2f %s", value, unit)
    }
    BEGIN {
      if (bytes < 1024) {
        printf "%d B\n", bytes
      } else if (bytes < 1024 * 1024) {
        printf "%s\n", fmt(bytes / 1024, "KB")
      } else if (bytes < 1024 * 1024 * 1024) {
        printf "%s\n", fmt(bytes / (1024 * 1024), "MB")
      } else {
        printf "%s\n", fmt(bytes / (1024 * 1024 * 1024), "GB")
      }
    }
  '
}

display_file_id() {
  if [[ -n "$CATEGORY" ]]; then
    printf '%s/%s\n' "$CATEGORY" "$SLOT"
    return
  fi
  printf '%s\n' "${PARENT_DIR#$ROOT_DIR/}/$SLOT"
}

display_title_line() {
  if [[ -n "$TITLE" && -n "$AUTHOR" ]]; then
    printf '%s - %s\n' "$TITLE" "$AUTHOR"
    return
  fi
  if [[ -n "$TITLE" ]]; then
    printf '%s\n' "$TITLE"
    return
  fi
  printf '%s\n' "$AUTHOR"
}

ensure_original_mp4() {
  local source_path="$1"
  local target_path="$2"
  if [[ "$source_path" == "$target_path" ]]; then
    return
  fi
  if [[ ! -f "$source_path" ]]; then
    echo "Downloaded source file is missing: $source_path" >&2
    exit 1
  fi
  if [[ "${source_path##*.}" == "mp4" ]]; then
    mv -f "$source_path" "$target_path"
    return
  fi
  require_bin "$FFMPEG_BIN" 'ffmpeg'
  local tmp_path="${target_path}.tmp.mp4"
  rm -f "$tmp_path"
  if "$FFMPEG_BIN" -y -hide_banner -loglevel error -i "$source_path" -map 0:v:0 -map 0:a? -c copy -movflags +faststart "$tmp_path"; then
    mv -f "$tmp_path" "$target_path"
    rm -f "$source_path"
    return
  fi
  rm -f "$tmp_path"
  "$FFMPEG_BIN" -y -hide_banner -loglevel error -i "$source_path" -map 0:v:0 -map 0:a? -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -ar 48000 "$tmp_path"
  mv -f "$tmp_path" "$target_path"
  rm -f "$source_path"
}

convert_reference() {
  require_bin "$FFMPEG_BIN" 'ffmpeg'
  local original_path="$1"
  local converted_path="$2"
  local tmp_path="${converted_path}.tmp.mp4"
  rm -f "$tmp_path"
  "$FFMPEG_BIN" -y -hide_banner -loglevel error -i "$original_path" -map 0:v:0 -map 0:a? -map_metadata 0 -dn -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -ar 48000 "$tmp_path"
  mv -f "$tmp_path" "$converted_path"
}

extract_metadata_record() {
  printf '%s' "$1" | "$NODE_BIN" -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const values = [
      String(data.id ?? ""),
      String(data.title ?? ""),
      String(data.uploader ?? data.channel ?? data.creator ?? data.uploader_id ?? ""),
      String(data.webpage_url ?? data.original_url ?? ""),
      String(data.extractor_key ?? data.extractor ?? "other"),
    ];
    process.stdout.write(values.join("\u001f"));
  '
}

existing_record_for_media_id() {
  local media_id_escaped
  media_id_escaped="$(sql_escape "$1")"
  db_query_sep "$(printf '\037')" "
    SELECT
      ifnull(slot,''),
      ifnull(parent_dir,''),
      ifnull(dir_path,''),
      ifnull(original_path,''),
      ifnull(converted_path,''),
      ifnull(title,''),
      ifnull(author,''),
      ifnull(resolved_url,''),
      ifnull(category,'')
    FROM media_files
    WHERE media_id = '$media_id_escaped'
    LIMIT 1;
  "
}

upsert_media_record() {
  local media_id="$1"
  local source_url="$2"
  local resolved_url="$3"
  local title="$4"
  local author="$5"
  local platform="$6"
  local category="$7"
  local parent_dir="$8"
  local slot="$9"
  local dir_path="${10}"
  local original_path="${11}"
  local converted_path="${12}"
  local original_size="${13}"
  local converted_size="${14}"
  local now
  now="$(date '+%Y-%m-%d %H:%M:%S')"

  db_exec "
    INSERT INTO media_files (
      media_id, source_url, resolved_url, title, author, platform, category,
      parent_dir, slot, dir_path, original_path, converted_path,
      original_size_bytes, converted_size_bytes, created_at, updated_at
    ) VALUES (
      '$(sql_escape "$media_id")',
      '$(sql_escape "$source_url")',
      '$(sql_escape "$resolved_url")',
      '$(sql_escape "$title")',
      '$(sql_escape "$author")',
      '$(sql_escape "$platform")',
      '$(sql_escape "$category")',
      '$(sql_escape "$parent_dir")',
      '$(sql_escape "$slot")',
      '$(sql_escape "$dir_path")',
      '$(sql_escape "$original_path")',
      '$(sql_escape "$converted_path")',
      $original_size,
      $converted_size,
      '$(sql_escape "$now")',
      '$(sql_escape "$now")'
    )
    ON CONFLICT(media_id) DO UPDATE SET
      source_url=excluded.source_url,
      resolved_url=CASE WHEN media_files.resolved_url IS NULL OR media_files.resolved_url = '' THEN excluded.resolved_url ELSE media_files.resolved_url END,
      title=CASE WHEN media_files.title IS NULL OR media_files.title = '' THEN excluded.title ELSE media_files.title END,
      author=CASE WHEN media_files.author IS NULL OR media_files.author = '' THEN excluded.author ELSE media_files.author END,
      platform=CASE WHEN media_files.platform IS NULL OR media_files.platform = '' THEN excluded.platform ELSE media_files.platform END,
      category=CASE WHEN media_files.category IS NULL OR media_files.category = '' THEN excluded.category ELSE media_files.category END,
      parent_dir=excluded.parent_dir,
      slot=excluded.slot,
      dir_path=excluded.dir_path,
      original_path=excluded.original_path,
      converted_path=excluded.converted_path,
      original_size_bytes=excluded.original_size_bytes,
      converted_size_bytes=excluded.converted_size_bytes,
      updated_at=excluded.updated_at;
  "
}

init_db
PARENT_DIR="$(build_parent_dir)"
mkdir -p "$PARENT_DIR"

METADATA_TMP="$(mktemp)"
if ! run_ytdlp_capture --dump-single-json --no-warnings --no-playlist "$URL" >"$METADATA_TMP"; then
  rm -f "$METADATA_TMP"
  exit 1
fi
METADATA_JSON="$(cat "$METADATA_TMP")"
rm -f "$METADATA_TMP"
METADATA_RECORD="$(extract_metadata_record "$METADATA_JSON")"
IFS=$'\x1f' read -r MEDIA_ID TITLE AUTHOR RESOLVED_URL PLATFORM <<< "$METADATA_RECORD"

if [[ -z "$MEDIA_ID" ]]; then
  echo "yt-dlp did not return media id" >&2
  exit 1
fi

EXISTING_RECORD="$(existing_record_for_media_id "$MEDIA_ID")"
STATUS="existing"
SLOT=""
DIR_PATH=""
ORIGINAL_PATH=""
CONVERTED_PATH=""
STORED_TITLE=""
STORED_AUTHOR=""
STORED_RESOLVED_URL=""
if [[ -n "$EXISTING_RECORD" ]]; then
  IFS=$'\037' read -r SLOT PARENT_DIR DIR_PATH ORIGINAL_PATH CONVERTED_PATH STORED_TITLE STORED_AUTHOR STORED_RESOLVED_URL STORED_CATEGORY <<< "$EXISTING_RECORD"
  if [[ -z "$DIR_PATH" || ! -d "$DIR_PATH" ]]; then
    MATCHED_DIR="$(find_slot_dir_by_prefix "$PARENT_DIR" "$SLOT")"
    if [[ -n "$MATCHED_DIR" ]]; then
      DIR_PATH="$MATCHED_DIR"
    else
      DIR_PATH="$PARENT_DIR/$SLOT"
      mkdir -p "$DIR_PATH"
    fi
    ORIGINAL_PATH="$DIR_PATH/reference_original.mp4"
    CONVERTED_PATH="$DIR_PATH/reference.mp4"
  fi
else
  SLOT="$(allocate_slot "$PARENT_DIR")"
  DIR_PATH="$PARENT_DIR/$SLOT"
  mkdir -p "$DIR_PATH"
  ORIGINAL_PATH="$DIR_PATH/reference_original.mp4"
  CONVERTED_PATH="$DIR_PATH/reference.mp4"
  STATUS="downloaded"
fi

if [[ -z "$TITLE" && -n "$STORED_TITLE" ]]; then
  TITLE="$STORED_TITLE"
fi
if [[ -z "$AUTHOR" && -n "$STORED_AUTHOR" ]]; then
  AUTHOR="$STORED_AUTHOR"
fi
if [[ -z "$RESOLVED_URL" && -n "$STORED_RESOLVED_URL" ]]; then
  RESOLVED_URL="$STORED_RESOLVED_URL"
fi
if [[ -z "$RESOLVED_URL" ]]; then
  RESOLVED_URL="$URL"
fi

if [[ ! -f "$ORIGINAL_PATH" ]]; then
  ALT_ORIGINAL="$(find "$DIR_PATH" -maxdepth 1 -type f -name 'reference_original.*' | sort | head -n 1)"
  if [[ -n "$ALT_ORIGINAL" ]]; then
    ensure_original_mp4 "$ALT_ORIGINAL" "$ORIGINAL_PATH"
    STATUS="repaired"
  fi
fi

if [[ ! -f "$ORIGINAL_PATH" ]]; then
  YTDLP_TMP="$(mktemp)"
  if ! run_ytdlp_capture --quiet --no-warnings --no-progress --no-playlist --merge-output-format mp4 --print 'after_move:%(filepath)s' --print 'after_move:%(webpage_url)s' -o "$DIR_PATH/reference_original.%(ext)s" "$URL" >"$YTDLP_TMP"; then
    rm -f "$YTDLP_TMP"
    exit 1
  fi
  YTDLP_OUTPUT="$(cat "$YTDLP_TMP")"
  rm -f "$YTDLP_TMP"
  DOWNLOADED_FILE="$(printf '%s\n' "$YTDLP_OUTPUT" | sed -n '1p' | sed 's/^after_move://')"
  RESOLVED_FROM_DOWNLOAD="$(printf '%s\n' "$YTDLP_OUTPUT" | sed -n '2p' | sed 's/^after_move://')"
  if [[ -n "$RESOLVED_FROM_DOWNLOAD" && "$RESOLVED_FROM_DOWNLOAD" != "NA" ]]; then
    RESOLVED_URL="$RESOLVED_FROM_DOWNLOAD"
  fi
  if [[ -z "$DOWNLOADED_FILE" || "$DOWNLOADED_FILE" == "NA" ]]; then
    DOWNLOADED_FILE="$(find "$DIR_PATH" -maxdepth 1 -type f -name 'reference_original.*' ! -name '*.part' | sort | head -n 1)"
  fi
  if [[ -z "$DOWNLOADED_FILE" ]]; then
    echo "Unable to locate downloaded file in $DIR_PATH" >&2
    exit 1
  fi
  ensure_original_mp4 "$DOWNLOADED_FILE" "$ORIGINAL_PATH"
  STATUS="downloaded"
fi

if [[ "$ENABLE_CONVERSION" == true && ! -f "$CONVERTED_PATH" ]]; then
  convert_reference "$ORIGINAL_PATH" "$CONVERTED_PATH"
  if [[ "$STATUS" == "existing" ]]; then
    STATUS="converted"
  elif [[ "$STATUS" == "repaired" ]]; then
    STATUS="repaired+converted"
  elif [[ "$STATUS" == "downloaded" ]]; then
    STATUS="downloaded+converted"
  fi
fi

ORIGINAL_SIZE="$(stat_size "$ORIGINAL_PATH")"
CONVERTED_SIZE="$(stat_size "$CONVERTED_PATH")"
upsert_media_record "$MEDIA_ID" "$URL" "$RESOLVED_URL" "$TITLE" "$AUTHOR" "$PLATFORM" "$CATEGORY" "$PARENT_DIR" "$SLOT" "$DIR_PATH" "$ORIGINAL_PATH" "$CONVERTED_PATH" "$ORIGINAL_SIZE" "$CONVERTED_SIZE"

printf '✅ Download ready\n'
printf 'Status: %s\n' "$STATUS"
printf 'Media ID: %s\n' "$MEDIA_ID"
if [[ -n "$CATEGORY" ]]; then
  printf 'Category: %s\n' "$CATEGORY"
else
  printf 'Category: date-grouped\n'
fi
printf 'Title: %s\n' "$(display_title_line)"
printf 'Original URL: %s\n' "$URL"
printf 'File ID: %s\n' "$(display_file_id)"
printf 'Original size: %s\n' "$(human_size "$ORIGINAL_SIZE")"
if [[ "$ENABLE_CONVERSION" == true ]]; then
  printf 'Converted size: %s\n' "$(human_size "$CONVERTED_SIZE")"
fi
