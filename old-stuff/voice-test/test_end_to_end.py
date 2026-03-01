#!/usr/bin/env python3
"""
End-to-end test script for conversation transcriber
Tests the full cycle: generate MD -> convert to audio -> transcribe back -> compare
"""

import os
import sys
import subprocess
import re
from pathlib import Path
from datetime import datetime
import difflib

class TestRunner:
    def __init__(self):
        self.test_results = []
        self.test_dir = Path("test_output")
        self.test_dir.mkdir(exist_ok=True)
        
        # Test file paths
        self.md_file = self.test_dir / "test_conversation.md"
        self.audio_file = self.test_dir / "test_audio.wav"
        self.transcript_file = self.test_dir / "test_transcript.txt"
        
    def print_header(self, text):
        print(f"\n{'='*60}")
        print(f"  {text}")
        print(f"{'='*60}")
        
    def print_step(self, step_num, description):
        print(f"\n[Step {step_num}] {description}")
        print("-" * 40)
        
    def print_result(self, success, message):
        if success:
            print(f"✅ PASS: {message}")
        else:
            print(f"❌ FAIL: {message}")
        self.test_results.append((success, message))
        
    def run_command(self, cmd):
        """Run a command and capture output"""
        print(f"Running: {' '.join(cmd)}")
        try:
            result = subprocess.run(
                cmd, 
                capture_output=True, 
                text=True, 
                check=True
            )
            print(f"Output: {result.stdout[:200]}..." if len(result.stdout) > 200 else f"Output: {result.stdout}")
            if result.stderr:
                print(f"Stderr: {result.stderr}")
            return True, result.stdout
        except subprocess.CalledProcessError as e:
            print(f"Error: {e}")
            print(f"Stdout: {e.stdout}")
            print(f"Stderr: {e.stderr}")
            return False, e.stderr
            
    def test_random_generation(self):
        """Test 1: Generate random conversation"""
        self.print_step(1, "Generate Random Conversation (20 seconds)")
        
        cmd = [
            "python", "conversation_transcriber.py",
            "--mode", "random",
            "--duration", "20",
            "--speakers", "3",
            "--output", str(self.md_file)
        ]
        
        success, _ = self.run_command(cmd)
        
        if success and self.md_file.exists():
            content = self.md_file.read_text()
            print(f"\nGenerated conversation preview:")
            print(content[:300] + "..." if len(content) > 300 else content)
            
            # Parse speakers from generated conversation
            speakers = set(re.findall(r'^([A-Za-z]+):', content, re.MULTILINE))
            self.print_result(len(speakers) >= 2, f"Generated conversation has {len(speakers)} speakers")
            return True, speakers
        else:
            self.print_result(False, "Failed to generate conversation")
            return False, set()
            
    def test_markdown_to_audio(self):
        """Test 2: Convert markdown to audio"""
        self.print_step(2, "Convert Markdown to Audio")
        
        if not self.md_file.exists():
            self.print_result(False, "Markdown file doesn't exist")
            return False
            
        cmd = [
            "python", "conversation_transcriber.py",
            "--mode", "generate",
            "--input", str(self.md_file),
            "--output", str(self.audio_file)
        ]
        
        success, _ = self.run_command(cmd)
        
        if success and self.audio_file.exists():
            file_size = self.audio_file.stat().st_size
            self.print_result(file_size > 1000, f"Audio file created: {file_size:,} bytes")
            return True
        else:
            self.print_result(False, "Failed to create audio file")
            return False
            
    def test_audio_transcription(self):
        """Test 3: Transcribe audio back to text"""
        self.print_step(3, "Transcribe Audio to Text")
        
        if not self.audio_file.exists():
            self.print_result(False, "Audio file doesn't exist")
            return False
            
        cmd = [
            "python", "conversation_transcriber.py",
            "--mode", "file",
            "--input", str(self.audio_file),
            "--output", str(self.transcript_file)
        ]
        
        success, _ = self.run_command(cmd)
        
        if success and self.transcript_file.exists():
            content = self.transcript_file.read_text()
            print(f"\nTranscribed conversation preview:")
            print(content[:300] + "..." if len(content) > 300 else content)
            self.print_result(True, "Transcription completed")
            return True
        else:
            self.print_result(False, "Failed to transcribe audio")
            return False
            
    def parse_conversation(self, text):
        """Parse conversation from text format"""
        conversations = []
        
        # Try to parse markdown format
        # Only match lines where speaker is a single word (no spaces)
        md_pattern = r'^([A-Za-z]+):\s*(.+)$'
        for line in text.split('\n'):
            # Skip header lines and metadata
            if line.startswith('#') or 'Duration:' in line or line.strip() == '':
                continue
            match = re.match(md_pattern, line)
            if match:
                speaker, utterance = match.groups()
                conversations.append({
                    'speaker': speaker.strip(),
                    'text': utterance.strip()
                })
        if conversations:
            return conversations
            
        # Try to parse transcript format [timestamp] Speaker: text
        transcript_pattern = r'\[[\d:]+\]\s*([^:]+):\s*(.+)'
        for line in text.split('\n'):
            # Skip header lines and empty lines
            if line.startswith('#') or line.strip() == '':
                continue
            match = re.match(transcript_pattern, line)
            if match:
                speaker, utterance = match.groups()
                conversations.append({
                    'speaker': speaker.strip(),
                    'text': utterance.strip()
                })
        return conversations
            
        return conversations
        
    def compare_conversations(self, original_speakers):
        """Test 4: Compare original and transcribed conversations"""
        self.print_step(4, "Compare Original and Transcribed Conversations")
        
        # Read original markdown
        original_text = self.md_file.read_text()
        original_conv = self.parse_conversation(original_text)
        
        # Read transcribed text
        transcript_text = self.transcript_file.read_text()
        transcript_conv = self.parse_conversation(transcript_text)
        
        print(f"\nOriginal conversation: {len(original_conv)} utterances")
        print(f"Transcribed conversation: {len(transcript_conv)} utterances")
        
        # Debug: show first few entries
        if len(original_conv) > 0:
            print(f"\nFirst original entry: {original_conv[0]}")
        if len(transcript_conv) > 0:
            print(f"First transcribed entry: {transcript_conv[0]}")
        
        # Create speaker mapping (original -> transcribed)
        speaker_map = {}
        
        # Check if we have enough data to compare
        if len(transcript_conv) == 0:
            self.print_result(False, "No transcribed conversation found")
            return False
            
        if len(original_conv) == 0:
            self.print_result(False, "No original conversation found")
            return False
        
        # Compare utterances
        matches = 0
        total = min(len(original_conv), len(transcript_conv))
        
        for i in range(total):
            orig = original_conv[i]
            trans = transcript_conv[i]
            
            # Map speakers
            if orig['speaker'] not in speaker_map:
                # Try to find matching speaker based on utterance similarity
                if trans['speaker'] not in speaker_map.values():
                    speaker_map[orig['speaker']] = trans['speaker']
            
            # Compare text (fuzzy matching)
            similarity = difflib.SequenceMatcher(None, 
                orig['text'].lower(), 
                trans['text'].lower()
            ).ratio()
            
            if similarity > 0.7:  # 70% similarity threshold
                matches += 1
                print(f"✓ Match {i+1}: {similarity:.1%} similar")
            else:
                print(f"✗ Mismatch {i+1}: {similarity:.1%} similar")
                print(f"  Original: {orig['speaker']}: {orig['text'][:50]}...")
                print(f"  Transcribed: {trans['speaker']}: {trans['text'][:50]}...")
        
        # Results
        accuracy = matches / total if total > 0 else 0
        self.print_result(accuracy >= 0.7, f"Content accuracy: {accuracy:.1%} ({matches}/{total} matches)")
        
        # Check speaker consistency
        print(f"\nSpeaker mapping:")
        for orig, trans in speaker_map.items():
            print(f"  {orig} -> {trans}")
        
        self.print_result(
            len(speaker_map) >= min(len(original_speakers), 3),
            f"Speaker diarization detected {len(speaker_map)} distinct speakers"
        )
        
        return accuracy >= 0.7
        
    def test_environment(self):
        """Test 0: Check environment setup"""
        self.print_step(0, "Environment Check")
        
        # Check Azure credentials
        key = os.environ.get('AZURE_SPEECH_KEY')
        region = os.environ.get('AZURE_SPEECH_REGION')
        
        if key and region:
            self.print_result(True, f"Azure credentials set (region: {region})")
        else:
            self.print_result(False, "Azure credentials not found in environment")
            print("\nPlease set:")
            print("  export AZURE_SPEECH_KEY='your-key'")
            print("  export AZURE_SPEECH_REGION='your-region'")
            return False
            
        # Check Python script exists
        if Path("conversation_transcriber.py").exists():
            self.print_result(True, "Main script found")
        else:
            self.print_result(False, "conversation_transcriber.py not found")
            return False
            
        # Check dependencies
        try:
            import azure.cognitiveservices.speech  # noqa: F401
            self.print_result(True, "Azure Speech SDK installed")
        except ImportError:
            self.print_result(False, "Azure Speech SDK not installed")
            return False
            
        return True
        
    def run_all_tests(self):
        """Run all tests in sequence"""
        self.print_header("CONVERSATION TRANSCRIBER END-TO-END TEST")
        print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # Test 0: Environment check
        if not self.test_environment():
            self.print_summary()
            return False
            
        # Test 1: Generate random conversation
        success, speakers = self.test_random_generation()
        if not success:
            self.print_summary()
            return False
            
        # Test 2: Convert to audio
        if not self.test_markdown_to_audio():
            self.print_summary()
            return False
            
        # Test 3: Transcribe audio
        if not self.test_audio_transcription():
            self.print_summary()
            return False
            
        # Test 4: Compare results
        if not self.compare_conversations(speakers):
            self.print_summary()
            return False
            
        self.print_summary()
        return True
        
    def print_summary(self):
        """Print test summary"""
        self.print_header("TEST SUMMARY")
        
        passed = sum(1 for success, _ in self.test_results if success)
        total = len(self.test_results)
        
        print(f"\nTotal tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        
        print("\nDetailed results:")
        for success, message in self.test_results:
            status = "PASS" if success else "FAIL"
            print(f"  [{status}] {message}")
            
        print("\n" + "="*60)
        if passed == total:
            print("🎉 ALL TESTS PASSED! 🎉")
        else:
            print(f"⚠️  {total - passed} TESTS FAILED")
        print("="*60)
        
    def cleanup(self):
        """Clean up test files"""
        print("\nCleaning up test files...")
        for file in [self.md_file, self.audio_file, self.transcript_file]:
            if file.exists():
                file.unlink()
                print(f"  Removed: {file}")

def main():
    runner = TestRunner()
    
    try:
        success = runner.run_all_tests()
        
        # Optional: cleanup test files
        response = input("\nClean up test files? (y/n): ")
        if response.lower() == 'y':
            runner.cleanup()
            
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()