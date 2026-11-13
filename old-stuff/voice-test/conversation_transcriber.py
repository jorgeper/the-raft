#!/usr/bin/env python3
import argparse
import sys
import os
from pathlib import Path

from transcriber import ConversationTranscriber
from generator import ConversationGenerator, MarkdownToAudio
from utils import setup_logging

def main():
    parser = argparse.ArgumentParser(
        description='Voice Conversation Transcriber with Speaker Diarization',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Transcribe from microphone
  %(prog)s --mode microphone
  
  # Transcribe from audio file
  %(prog)s --mode file --input meeting.wav
  
  # Generate random conversation
  %(prog)s --mode random --duration 60 --output conversation.md
  
  # Convert markdown to audio
  %(prog)s --mode generate --input conversation.md --output audio.wav
        """
    )
    
    parser.add_argument(
        '--mode', 
        choices=['microphone', 'file', 'random', 'generate'],
        required=True,
        help='Operation mode'
    )
    
    parser.add_argument(
        '--input', 
        type=str,
        help='Input file path (for file/generate modes)'
    )
    
    parser.add_argument(
        '--output', 
        type=str,
        help='Output file path'
    )
    
    parser.add_argument(
        '--duration', 
        type=int,
        default=60,
        help='Duration in seconds for random conversation (default: 60)'
    )
    
    parser.add_argument(
        '--speakers', 
        type=int,
        default=3,
        help='Number of speakers for random conversation (default: 3)'
    )
    
    parser.add_argument(
        '--topic', 
        type=str,
        help='Topic for random conversation'
    )
    
    parser.add_argument(
        '--config', 
        type=str,
        default='config.yaml',
        help='Configuration file path (default: config.yaml)'
    )
    
    parser.add_argument(
        '--verbose', 
        action='store_true',
        help='Enable verbose logging'
    )
    
    args = parser.parse_args()
    
    # Setup logging
    setup_logging(verbose=args.verbose)
    
    # Validate arguments
    if args.mode in ['file', 'generate'] and not args.input:
        parser.error(f"--input is required for {args.mode} mode")
    
    # Check Azure credentials
    if args.mode in ['microphone', 'file', 'generate']:
        if not os.environ.get('AZURE_SPEECH_KEY') or not os.environ.get('AZURE_SPEECH_REGION'):
            print("Error: Azure Speech credentials not found!")
            print("Please set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables.")
            print("See README.md for setup instructions.")
            sys.exit(1)
    
    try:
        if args.mode == 'microphone':
            transcriber = ConversationTranscriber()
            print("Starting microphone transcription...")
            print("Press Ctrl+C to stop")
            transcriber.transcribe_from_microphone(output_file=args.output)
            
        elif args.mode == 'file':
            if not Path(args.input).exists():
                print(f"Error: Input file '{args.input}' not found")
                sys.exit(1)
            transcriber = ConversationTranscriber()
            print(f"Transcribing from file: {args.input}")
            transcriber.transcribe_from_file(args.input, output_file=args.output)
            
        elif args.mode == 'random':
            generator = ConversationGenerator()
            output_path = args.output or 'conversation.md'
            print(f"Generating {args.duration}s conversation with {args.speakers} speakers...")
            generator.generate_random_conversation(
                duration=args.duration,
                num_speakers=args.speakers,
                topic=args.topic,
                output_file=output_path
            )
            print(f"Conversation saved to: {output_path}")
            
        elif args.mode == 'generate':
            if not Path(args.input).exists():
                print(f"Error: Input file '{args.input}' not found")
                sys.exit(1)
            converter = MarkdownToAudio(config_file=args.config)
            output_path = args.output or 'output.wav'
            print(f"Converting markdown to audio: {args.input}")
            converter.convert_to_audio(args.input, output_path)
            print(f"Audio saved to: {output_path}")
            
    except KeyboardInterrupt:
        print("\n\nTranscription stopped by user")
    except Exception as e:
        print(f"\nError: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()