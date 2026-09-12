# YuE2 Windows worker

`music-worker.ps1` polls the authenticated worker endpoint at XEDOC Play, runs one Q4 YuE2 request on the local CUDA GPU, then uploads the completed WAV. It does not expose the GPU or audio.cpp HTTP service to the public network.

Before registering the worker, run `install-style-translator.ps1`. It installs an offline Russian-to-English Argos model on the same computer. The worker translates Cyrillic style prompts locally immediately before starting YuE2; lyrics are deliberately accepted only in English by the API.

Create `C:\ProgramData\XEDOCPlay\music-worker.json` from `music-worker.config.example.json`, with the generated production worker token. Register it as a background scheduled task only after the API deployment and a local CLI generation both succeed.
