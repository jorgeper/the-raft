# Voice Conversation Transcriber

```
     _____ _____ _____ _____ _____    _____ _____ _____ _____ _____ 
    |  |  |     |     |     |   __|  |_   _| __  |  _  |   | |   __|
    |  |  |  |  |-   -|   --|   __|    | | |    -|     | | | |__   |
     \___/|_____|_____|_____|_____|    |_| |__|__|__|__|_|___|_____|
                                                                      
    🎤 Real-time Speech Recognition with Speaker Diarization 🗣️
```

A Python application for real-time conversation transcription with speaker diarization using Azure Cognitive Services.

## Features

- Real-time transcription from microphone input
- Transcription from audio files
- Speaker diarization (identifies different speakers)
- Generate synthetic conversations for testing
- Convert markdown conversations to audio files

## Prerequisites

- Python 3.8+
- Azure account with Speech Services enabled
- macOS/Linux/Windows
- FFmpeg (for audio processing)
- PortAudio (for microphone access)

## Azure Setup Instructions

### 1. Create Azure Account
1. Go to [Azure Portal](https://portal.azure.com)
2. Sign up for a free account (includes $200 credit)

### 2. Create Speech Service Resource
1. In Azure Portal, click "Create a resource"
2. Search for "Speech" and select "Speech" by Microsoft
3. Click "Create"
4. Fill in the details:
   - **Subscription**: Select your subscription
   - **Resource group**: Create new or select existing
   - **Region**: Choose closest to you (e.g., "East US")
   - **Name**: Your unique resource name (e.g., "voice-transcriber")
   - **Pricing tier**: F0 (free) or S0 (standard)
5. Click "Review + create" then "Create"

### 3. Get Your Credentials
1. Once deployed, go to your Speech resource
2. Click on "Keys and Endpoint" in the left menu
3. Copy:
   - **Key 1** or **Key 2** (either works)
   - **Location/Region** (e.g., "eastus")
   - **Endpoint** (optional, SDK can auto-generate)

### 4. Set Environment Variables

#### macOS/Linux:
```bash
export AZURE_SPEECH_KEY="your-key-here"
export AZURE_SPEECH_REGION="your-region-here"
```

Add to `~/.bashrc` or `~/.zshrc` to persist.

#### Windows:
```cmd
setx AZURE_SPEECH_KEY "your-key-here"
setx AZURE_SPEECH_REGION "your-region-here"
```

## Installation

### Install System Dependencies

#### macOS:
```bash
brew install portaudio ffmpeg
```

#### Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install portaudio19-dev ffmpeg
```

#### Windows:
- Download and install FFmpeg from https://ffmpeg.org/download.html
- PyAudio wheels include PortAudio

### Install Python Dependencies

```bash
# Clone the repository
git clone <your-repo-url>
cd voice-test

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Usage

### 1. Transcribe from Microphone
```bash
python conversation_transcriber.py --mode microphone
```

### 2. Transcribe from Audio File
```bash
python conversation_transcriber.py --mode file --input meeting.wav
```

### 3. Generate Random Conversation
```bash
python conversation_transcriber.py --mode random --duration 60 --output test_conversation.md
```

### 4. Convert Markdown to Audio
```bash
python conversation_transcriber.py --mode generate --input conversation.md --output conversation.wav
```

## Markdown Conversation Format

```markdown
# Conversation: Team Meeting

Alice: Hey everyone, let's discuss the new feature.

Bob: Sure! I've been working on the API integration.

Charlie: Great. When can we test it?

Alice: Bob, what's your timeline?

Bob: Should be ready by tomorrow.
```

## Configuration

Create `config.yaml` to customize voices:
```yaml
speakers:
  Alice: 
    voice: en-US-JennyNeural
    rate: 1.0
  Bob:
    voice: en-US-GuyNeural
    pitch: -2
  Charlie:
    voice: en-GB-RyanNeural
```

## Azure Pricing

- **Free tier (F0)**: 
  - 5 hours of speech-to-text per month
  - 0.5 million characters text-to-speech per month
- **Standard tier (S0)**:
  - $1 per audio hour for speech-to-text
  - $16 per 1 million characters for neural TTS

## Troubleshooting

### "Authentication failed"
- Verify your key and region are correct
- Ensure environment variables are set
- Check if your Azure subscription is active

### "No audio input"
- Grant microphone permissions
- Check audio input device in system settings
- Try specifying device: `--device 1`

### "Speaker diarization not working"
- Ensure you're using a supported region
- Minimum 2 speakers required
- Audio quality affects accuracy

## License

MIT