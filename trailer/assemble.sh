#!/bin/sh
# Cuts the recorded frames and the score together into trailer/out/qubecraft-trailer.mp4:
# a touch of contrast and colour, a soft vignette, and the score levelled for
# streaming (-14 LUFS) with a short fade at the end.
set -e
cd "$(dirname "$0")/out"
DUR=$(ls frames | wc -l | awk '{ printf "%.3f", $1 / 30 }')
ffmpeg -hide_banner -y -loglevel error -stats \
  -framerate 30 -i frames/%05d.jpg -i score.wav \
  -filter_complex "[0:v]eq=contrast=1.05:saturation=1.12:gamma=0.98,vignette=angle=0.42,format=yuv420p[v];[1:a]atrim=0:${DUR},loudnorm=I=-14:TP=-1.2:LRA=11,afade=t=out:st=$(echo "$DUR - 2.5" | bc):d=2.5[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 18 -tune film -movflags +faststart -c:a aac -b:a 320k -ar 48000 \
  qubecraft-trailer.mp4
ffprobe -v error -show_entries format=duration,size -of default=nw=1 qubecraft-trailer.mp4
