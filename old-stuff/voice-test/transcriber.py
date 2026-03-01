import os
import azure.cognitiveservices.speech as speechsdk
import threading
import time
from datetime import datetime
from rich.console import Console
from rich.live import Live
from rich.table import Table
from rich.text import Text
import wave
import json

console = Console()

class ConversationTranscriber:
    def __init__(self):
        self.speech_key = os.environ.get('AZURE_SPEECH_KEY')
        self.speech_region = os.environ.get('AZURE_SPEECH_REGION')
        
        if not self.speech_key or not self.speech_region:
            raise ValueError("Azure Speech credentials not found in environment variables")
        
        self.speakers = {}
        self.transcript = []
        self.is_transcribing = False
        self.colors = ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan']
        self.speaker_colors = {}
        
    def _get_speaker_color(self, speaker_id):
        if speaker_id not in self.speaker_colors:
            color_index = len(self.speaker_colors) % len(self.colors)
            self.speaker_colors[speaker_id] = self.colors[color_index]
        return self.speaker_colors[speaker_id]
    
    def _create_conversation_recognizer(self, audio_config):
        speech_config = speechsdk.SpeechConfig(
            subscription=self.speech_key, 
            region=self.speech_region
        )
        speech_config.speech_recognition_language = "en-US"
        speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous"
        )
        
        # Enable speaker diarization using the correct property names for SDK v1.45
        speech_config.set_property_by_name("ConversationTranscriptionInRoomAndOnline", "true")
        speech_config.set_property_by_name("DifferentiateGuestSpeakers", "true")
        
        return speechsdk.transcription.ConversationTranscriber(
            speech_config=speech_config,
            audio_config=audio_config
        )
    
    def _display_transcript(self):
        table = Table(title="Live Transcription", show_header=True, header_style="bold magenta")
        table.add_column("Time", style="dim", width=12)
        table.add_column("Speaker", width=12)
        table.add_column("Text", width=60)
        
        # Show last 10 entries
        for entry in self.transcript[-10:]:
            time_str = entry['timestamp'].strftime("%H:%M:%S")
            speaker_color = self._get_speaker_color(entry['speaker'])
            speaker_text = Text(entry['speaker'], style=speaker_color)
            table.add_row(time_str, speaker_text, entry['text'])
        
        return table
    
    def _handle_transcribed(self, evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            speaker_id = evt.result.speaker_id or "Unknown"
            
            # Create speaker label
            if speaker_id not in self.speakers:
                self.speakers[speaker_id] = f"Speaker {len(self.speakers) + 1}"
            
            speaker_label = self.speakers[speaker_id]
            
            # Add to transcript
            self.transcript.append({
                'timestamp': datetime.now(),
                'speaker': speaker_label,
                'text': evt.result.text,
                'speaker_id': speaker_id
            })
            
            # Print to console with color
            color = self._get_speaker_color(speaker_label)
            console.print(f"[{color}]{speaker_label}:[/{color}] {evt.result.text}")
    
    def _handle_session_stopped(self, evt):
        self.is_transcribing = False
        console.print("\n[bold green]Transcription completed[/bold green]")
    
    def transcribe_from_microphone(self, output_file=None):
        audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)
        conversation_transcriber = self._create_conversation_recognizer(audio_config)
        
        # Connect callbacks
        conversation_transcriber.transcribed.connect(self._handle_transcribed)
        conversation_transcriber.session_stopped.connect(self._handle_session_stopped)
        conversation_transcriber.canceled.connect(self._handle_session_stopped)
        
        # Start transcription
        self.is_transcribing = True
        conversation_transcriber.start_transcribing_async().get()
        
        console.print("[bold green]Transcription started. Speak into your microphone...[/bold green]")
        console.print("[dim]Press Ctrl+C to stop[/dim]\n")
        
        try:
            while self.is_transcribing:
                time.sleep(0.1)
        except KeyboardInterrupt:
            pass
        
        # Stop transcription
        conversation_transcriber.stop_transcribing_async().get()
        
        # Save transcript if requested
        if output_file:
            self._save_transcript(output_file)
    
    def transcribe_from_file(self, audio_file, output_file=None):
        # Validate file format
        if not audio_file.endswith('.wav'):
            console.print("[red]Error: Only WAV files are supported[/red]")
            return
        
        audio_config = speechsdk.audio.AudioConfig(filename=audio_file)
        conversation_transcriber = self._create_conversation_recognizer(audio_config)
        
        # Connect callbacks
        conversation_transcriber.transcribed.connect(self._handle_transcribed)
        conversation_transcriber.session_stopped.connect(self._handle_session_stopped)
        conversation_transcriber.canceled.connect(self._handle_session_stopped)
        
        # Start transcription
        self.is_transcribing = True
        conversation_transcriber.start_transcribing_async().get()
        
        console.print(f"[bold green]Transcribing file: {audio_file}[/bold green]")
        console.print("[dim]Processing...[/dim]\n")
        
        # Wait for completion
        while self.is_transcribing:
            time.sleep(0.1)
        
        # Save transcript if requested
        if output_file:
            self._save_transcript(output_file)
    
    def _save_transcript(self, output_file):
        if output_file.endswith('.json'):
            # Save as JSON
            with open(output_file, 'w') as f:
                json_data = []
                for entry in self.transcript:
                    json_data.append({
                        'timestamp': entry['timestamp'].isoformat(),
                        'speaker': entry['speaker'],
                        'text': entry['text']
                    })
                json.dump(json_data, f, indent=2)
        else:
            # Save as text/markdown
            with open(output_file, 'w') as f:
                f.write(f"# Conversation Transcript\n")
                f.write(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                
                for entry in self.transcript:
                    time_str = entry['timestamp'].strftime("%H:%M:%S")
                    f.write(f"[{time_str}] {entry['speaker']}: {entry['text']}\n\n")
        
        console.print(f"\n[green]Transcript saved to: {output_file}[/green]")