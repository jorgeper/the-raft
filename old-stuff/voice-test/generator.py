import os
import random
import azure.cognitiveservices.speech as speechsdk
from datetime import datetime
import yaml
import re
from pathlib import Path
import wave
import struct
from pydub import AudioSegment
from pydub.silence import split_on_silence
from pydub.utils import which

# Set ffmpeg path if installed via homebrew
if not which("ffmpeg"):
    homebrew_ffmpeg = "/opt/homebrew/bin/ffmpeg"
    if os.path.exists(homebrew_ffmpeg):
        AudioSegment.converter = homebrew_ffmpeg

class ConversationGenerator:
    def __init__(self):
        self.topics = {
            'product launch': [
                "Let's discuss the timeline for our new product launch.",
                "The marketing team needs at least two weeks for the campaign.",
                "What about the technical requirements?",
                "We should be ready for beta testing next week.",
                "I'm concerned about the user interface changes.",
                "Those are minor tweaks, shouldn't delay us.",
                "Have we considered the international markets?",
                "Yes, localization is already in progress.",
                "What's our contingency plan if we hit delays?",
                "We have a buffer built into the schedule."
            ],
            'team meeting': [
                "Good morning everyone, let's get started.",
                "First, let's review last week's progress.",
                "I completed the API integration as planned.",
                "Great! Any blockers we should discuss?",
                "I'm waiting on design specs for the dashboard.",
                "I'll get those to you by end of day.",
                "How's the testing going?",
                "Found a few edge cases, but nothing critical.",
                "Let's schedule a follow-up for Friday.",
                "Sounds good, same time works for me."
            ],
            'technical debugging': [
                "The system is throwing timeout errors again.",
                "When did this start happening?",
                "About an hour ago, right after the deployment.",
                "Did we change any configuration settings?",
                "Just updated the connection pool size.",
                "That might be it. Let's check the logs.",
                "I'm seeing a lot of connection refused errors.",
                "Try rolling back the config change.",
                "Okay, reverting now.",
                "Errors stopped. That was definitely the issue."
            ],
            'project planning': [
                "We need to define our Q2 objectives.",
                "I think we should focus on performance improvements.",
                "What about the new features customers requested?",
                "We could tackle both with the right prioritization.",
                "Let's list everything and assign complexity scores.",
                "Good idea. I'll create a planning document.",
                "We should also consider technical debt.",
                "Agreed. The codebase needs some refactoring.",
                "How many engineers can we dedicate to this?",
                "I'd say three full-time, plus part-time support."
            ]
        }
        
        self.speaker_names = [
            'Alice', 'Bob', 'Charlie', 'Diana', 'Emma', 
            'Frank', 'Grace', 'Henry', 'Iris', 'Jack'
        ]
        
        self.transitions = [
            "By the way,",
            "Speaking of which,",
            "That reminds me,",
            "Also,",
            "On another note,",
            "Quick question -",
            "Before I forget,",
            "One more thing,",
        ]
    
    def generate_random_conversation(self, duration=60, num_speakers=3, topic=None, output_file='conversation.md'):
        # Select topic
        if topic and topic in self.topics:
            selected_topic = topic
        else:
            selected_topic = random.choice(list(self.topics.keys()))
        
        # Select speakers
        speakers = random.sample(self.speaker_names, min(num_speakers, len(self.speaker_names)))
        
        # Estimate words needed (150 words per minute average speaking rate)
        target_words = int(duration * 150 / 60)
        
        # Generate conversation
        conversation = []
        utterances = self.topics[selected_topic].copy()
        random.shuffle(utterances)
        
        word_count = 0
        utterance_index = 0
        
        while word_count < target_words:
            speaker = random.choice(speakers)
            
            if utterance_index < len(utterances):
                text = utterances[utterance_index]
                utterance_index += 1
            else:
                # Generate variations or transitions
                if random.random() < 0.3 and conversation:
                    # Add a transition
                    transition = random.choice(self.transitions)
                    base_utterance = random.choice(utterances)
                    text = f"{transition} {base_utterance.lower()}"
                else:
                    # Reuse with slight variations
                    text = random.choice(utterances)
            
            conversation.append({
                'speaker': speaker,
                'text': text
            })
            
            word_count += len(text.split())
        
        # Write to markdown file
        with open(output_file, 'w') as f:
            f.write(f"# Conversation: {selected_topic.title()}\n")
            f.write(f"# Duration: ~{duration} seconds\n\n")
            
            for entry in conversation:
                f.write(f"{entry['speaker']}: {entry['text']}\n\n")
        
        return output_file


class MarkdownToAudio:
    def __init__(self, config_file='config.yaml'):
        self.speech_key = os.environ.get('AZURE_SPEECH_KEY')
        self.speech_region = os.environ.get('AZURE_SPEECH_REGION')
        
        if not self.speech_key or not self.speech_region:
            raise ValueError("Azure Speech credentials not found in environment variables")
        
        # Load voice configuration
        self.voice_config = self._load_voice_config(config_file)
        
        # Default voices if not configured
        self.default_voices = [
            'en-US-JennyNeural',
            'en-US-GuyNeural',
            'en-US-AriaNeural',
            'en-US-DavisNeural',
            'en-GB-SoniaNeural',
            'en-AU-NatashaNeural'
        ]
    
    def _load_voice_config(self, config_file):
        if Path(config_file).exists():
            with open(config_file, 'r') as f:
                config = yaml.safe_load(f)
                return config.get('speakers', {})
        return {}
    
    def _parse_markdown(self, markdown_file):
        conversation = []
        
        with open(markdown_file, 'r') as f:
            lines = f.readlines()
        
        # Skip header lines
        in_conversation = False
        for line in lines:
            line = line.strip()
            
            if not line:
                continue
            
            # Look for speaker: text pattern
            match = re.match(r'^([A-Za-z]+):\s*(.+)$', line)
            if match:
                speaker = match.group(1)
                text = match.group(2)
                conversation.append({
                    'speaker': speaker,
                    'text': text
                })
                in_conversation = True
        
        return conversation
    
    def _get_voice_for_speaker(self, speaker, speaker_index):
        if speaker in self.voice_config:
            return self.voice_config[speaker].get('voice', self.default_voices[speaker_index % len(self.default_voices)])
        else:
            return self.default_voices[speaker_index % len(self.default_voices)]
    
    def _text_to_speech(self, text, voice_name, output_file):
        speech_config = speechsdk.SpeechConfig(
            subscription=self.speech_key,
            region=self.speech_region
        )
        speech_config.speech_synthesis_voice_name = voice_name
        
        # Set output format to wav
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
        )
        
        # Create synthesizer with file output
        audio_config = speechsdk.audio.AudioOutputConfig(filename=output_file)
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config,
            audio_config=audio_config
        )
        
        # Generate speech
        result = synthesizer.speak_text_async(text).get()
        
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return True
        else:
            print(f"Speech synthesis failed: {result.reason}")
            return False
    
    def convert_to_audio(self, markdown_file, output_file):
        # Parse conversation
        conversation = self._parse_markdown(markdown_file)
        
        if not conversation:
            raise ValueError("No conversation found in markdown file")
        
        # Track speakers
        speakers = {}
        audio_segments = []
        
        print(f"Generating audio for {len(conversation)} utterances...")
        
        # Generate audio for each utterance
        for i, entry in enumerate(conversation):
            speaker = entry['speaker']
            text = entry['text']
            
            # Assign voice to speaker
            if speaker not in speakers:
                speaker_index = len(speakers)
                speakers[speaker] = self._get_voice_for_speaker(speaker, speaker_index)
            
            voice = speakers[speaker]
            
            # Generate temporary audio file
            temp_file = f"temp_{i}.wav"
            print(f"  [{i+1}/{len(conversation)}] {speaker}: {text[:50]}...")
            
            if self._text_to_speech(text, voice, temp_file):
                # Load audio segment
                audio = AudioSegment.from_wav(temp_file)
                
                # Add small pause between speakers (300ms)
                if i > 0:
                    silence = AudioSegment.silent(duration=300)
                    audio_segments.append(silence)
                
                audio_segments.append(audio)
                
                # Clean up temp file
                os.remove(temp_file)
            else:
                print(f"Failed to generate audio for: {speaker}: {text}")
        
        # Combine all segments
        print("Combining audio segments...")
        if audio_segments:
            combined = audio_segments[0]
            for segment in audio_segments[1:]:
                combined += segment
            
            # Export final audio
            combined.export(output_file, format="wav")
            print(f"Audio saved to: {output_file}")
        else:
            raise ValueError("No audio segments were generated")