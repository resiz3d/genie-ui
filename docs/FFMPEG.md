# Installing ffmpeg

ffmpeg is **optional**. GENie generates, saves and plays everything without it; a few
tools use it when it's there:

| Tool | Needs | Without it |
| --- | --- | --- |
| **✂ Video editor** (header, and ✂ Edit video on cards) | `ffmpeg` | You can still step through a video and save frames, at an assumed 24 fps, but not cut, join or save video. |
| **Use last N sec** on a reference video | `ffprobe` | The run stops with a "couldn't read the length" error. |

`ffprobe` ships with ffmpeg, so one install covers both. GENie never downloads ffmpeg
itself.

## Windows

Pick one. The first is the easiest.

**winget** (built into Windows 10/11) — open a terminal and run:

```
winget install Gyan.FFmpeg
```

**Chocolatey** or **Scoop**, if you already use one:

```
choco install ffmpeg
scoop install ffmpeg
```

**By hand** — download a "release full" build from <https://www.gyan.dev/ffmpeg/builds/>
(or <https://github.com/BtbN/FFmpeg-Builds/releases>), extract it somewhere permanent
such as `C:\ffmpeg`, then either add its `bin` folder to your PATH (Start → "Edit the
system environment variables" → Environment Variables → Path → New) or skip PATH and
[point GENie at it](#if-ffmpeg-isnt-on-your-path).

## macOS

With [Homebrew](https://brew.sh):

```
brew install ffmpeg
```

With MacPorts: `sudo port install ffmpeg`.

## Linux

| Distro | Command |
| --- | --- |
| Debian / Ubuntu / Mint | `sudo apt install ffmpeg` |
| Arch / Manjaro | `sudo pacman -S ffmpeg` |
| Fedora | `sudo dnf install ffmpeg` — from [RPM Fusion](https://rpmfusion.org/Configuration) (see below) |
| openSUSE | `sudo zypper install ffmpeg` — from the [Packman](https://en.opensuse.org/Additional_package_repositories#Packman) repository (see below) |

The video editor encodes H.264 with `libx264`. Fedora's own `ffmpeg-free` and openSUSE's
stock package are built without it, so on those two install ffmpeg from the repository
named above. To check any build:

```
ffmpeg -hide_banner -encoders | grep libx264
```

## Check it worked

Open a **new** terminal (one that was already open won't see the change) and run:

```
ffmpeg -version
ffprobe -version
```

Each should print a version. Then **restart GENie from that new terminal** — stop it
with Ctrl+C and run `npm start` again — because a running server keeps the PATH it
started with.

## If ffmpeg isn't on your PATH

The video editor can be told where ffmpeg is. In `.env`:

```
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
```

Restart GENie afterwards. This covers the video editor only; the `ffprobe` feature
above still looks for `ffprobe` on the PATH.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The video editor still says "ffmpeg was not found" after installing | GENie was started before the install, or from an old terminal. Close it, open a new terminal, `npm start`. |
| `ffmpeg -version` works in one terminal but not another | The other terminal predates the install — open a fresh one. |
| An export fails with `Unknown encoder 'libx264'` | Your ffmpeg was built without x264 — see the Linux note above. |
