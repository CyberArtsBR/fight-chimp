#!/usr/bin/env bash
set -euo pipefail

mkdir -p public/models

valid_glb() {
  [[ -f "$1" ]] && [[ "$(head -c 4 "$1" || true)" == "glTF" ]]
}

download_glb() {
  local id="$1"
  local out="$2"
  local url="https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t"

  if valid_glb "${out}"; then
    echo "Using existing $(basename "${out}") ($(du -h "${out}" | cut -f1))"
    return
  fi

  echo "Downloading ${out}..."
  curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180 \
    --output "${out}.tmp" "${url}"

  if [[ "$(head -c 4 "${out}.tmp" || true)" != "glTF" ]]; then
    echo "ERROR: ${out} is not a valid binary GLB (expected glTF magic header)."
    file "${out}.tmp" || true
    rm -f "${out}.tmp"
    exit 1
  fi

  mv "${out}.tmp" "${out}"
  echo "Validated $(basename "${out}") ($(du -h "${out}" | cut -f1))"
}

download_glb "18YdEX7NPGljrh42ReQTozH86GI2hk9SQ" "public/models/fighter-1.glb"
download_glb "1TnullbZPmvmryGPs95IkBaRdm6hE8oqe" "public/models/fighter-2.glb"

echo "Both Chimpion GLB files are ready."
