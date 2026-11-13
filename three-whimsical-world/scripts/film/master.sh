#!/bin/bash
# Masters the soundscape (levels evened out between shots, -14 LUFS for YouTube) and muxes it with the rendered
# shots into recordings/meadows-demo-1080p60.mp4. Run after record-video.mjs, record-audio.mjs and assemble-audio.mjs.
set -e
PRE="dynaudnorm=f=500:g=21:m=6:p=0.7"
J=$(ffmpeg -v info -i recordings/film-audio.wav -af "${PRE},loudnorm=I=-14:TP=-1.5:LRA=18:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
F=$(node -e 'const j=JSON.parse(process.argv[1]); console.log(`measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`)' "$J")
ffmpeg -v error -y -i recordings/film-audio.wav -af "${PRE},loudnorm=I=-14:TP=-1.5:LRA=18:${F}:linear=true,aresample=48000" -c:a aac -b:a 320k recordings/film-audio.m4a
ls recordings/segs/shot*.mp4 | grep -v part | sort | sed "s|^|file '$PWD/|; s|$|'|" > recordings/concat.txt
ffmpeg -v error -y -f concat -safe 0 -i recordings/concat.txt -i recordings/film-audio.m4a -map 0:v -map 1:a -c copy -shortest \
  -movflags +faststart -metadata title="Meadows — a living world in Three.js" recordings/meadows-demo-1080p60.mp4
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of compact recordings/meadows-demo-1080p60.mp4
