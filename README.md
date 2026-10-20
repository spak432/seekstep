# Seekstep

## Introduction

I was studying English, got annoyed at how hard it was to replay one short line, and knocked this together. The arrow keys jump 5 seconds. `[` and `]` jump 3 seconds. It works on YouTube, Netflix, Disney+, Peacock, Prime Video, Tubi, and Coupang Play.

After I switched to it, my listening got a lot better.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` | Back 5 seconds |
| `→` | Forward 5 seconds |
| `[` | Back 3 seconds |
| `]` | Forward 3 seconds |

## Installation

Chrome and Firefox each have their own folder. `content.js` and `netflix_main.js` stay identical in both. The Firefox manifest adds an add-on id and requires Firefox 128 or newer, because Netflix seek runs in the page.

### Chrome

1. Clone this repository or download it as a ZIP file.
   ```bash
   git clone https://github.com/spak432/seekstep.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on Developer mode.
4. Click **Load unpacked** and select the `chrome` folder.

### Firefox

1. Clone this repository or download it as a ZIP file.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on** and select `firefox/manifest.json`.

A temporary add-on is removed when Firefox quits. Load it again after you reopen Firefox.

Release Firefox only keeps a signed add-on. On Developer Edition, Nightly, or ESR you can keep this unsigned one:

1. Open `about:config` and set `xpinstall.signatures.required` to `false`.
2. Pack the `firefox` folder so `manifest.json` is at the root of the zip.
   ```bash
   cd firefox
   zip -r ../seekstep.xpi manifest.json content.js netflix_main.js
   ```
3. Open `about:addons`, click the gear, choose **Install Add-on From File**, and select `seekstep.xpi`.

That install stays after you quit Firefox.

## Usage

Open a video and use the keys above.

## License

This project is under the MIT License.
