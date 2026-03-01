#!/usr/bin/env python3
"""Test script to verify all dependencies are installed correctly"""

import sys

def test_imports():
    print("Testing imports...")
    try:
        import azure.cognitiveservices.speech as speechsdk
        print("✓ Azure Speech SDK")
    except ImportError as e:
        print(f"✗ Azure Speech SDK: {e}")
        return False
    
    try:
        import pyaudio
        print("✓ PyAudio")
    except ImportError as e:
        print(f"✗ PyAudio: {e}")
        return False
    
    try:
        import numpy
        print("✓ NumPy")
    except ImportError as e:
        print(f"✗ NumPy: {e}")
        return False
    
    try:
        from pydub import AudioSegment
        print("✓ PyDub")
    except ImportError as e:
        print(f"✗ PyDub: {e}")
        return False
    
    try:
        import colorama
        print("✓ Colorama")
    except ImportError as e:
        print(f"✗ Colorama: {e}")
        return False
    
    try:
        from rich.console import Console
        print("✓ Rich")
    except ImportError as e:
        print(f"✗ Rich: {e}")
        return False
    
    try:
        import yaml
        print("✓ PyYAML")
    except ImportError as e:
        print(f"✗ PyYAML: {e}")
        return False
    
    return True

def test_azure_credentials():
    print("\nTesting Azure credentials...")
    import os
    
    key = os.environ.get('AZURE_SPEECH_KEY')
    region = os.environ.get('AZURE_SPEECH_REGION')
    
    if key:
        print(f"✓ AZURE_SPEECH_KEY is set (length: {len(key)})")
    else:
        print("✗ AZURE_SPEECH_KEY is not set")
        return False
    
    if region:
        print(f"✓ AZURE_SPEECH_REGION is set: {region}")
    else:
        print("✗ AZURE_SPEECH_REGION is not set")
        return False
    
    return True

def test_audio():
    print("\nTesting audio devices...")
    try:
        import pyaudio
        p = pyaudio.PyAudio()
        
        # Get default input device
        try:
            default_input = p.get_default_input_device_info()
            print(f"✓ Default microphone: {default_input['name']}")
        except Exception as e:
            print(f"✗ No default microphone found: {e}")
            return False
        
        # List all audio devices
        print("\nAvailable audio devices:")
        for i in range(p.get_device_count()):
            info = p.get_device_info_by_index(i)
            if info['maxInputChannels'] > 0:
                print(f"  [{i}] {info['name']} (input channels: {info['maxInputChannels']})")
        
        p.terminate()
        return True
    except Exception as e:
        print(f"✗ PyAudio error: {e}")
        return False

def main():
    print("Voice Transcriber Setup Test")
    print("=" * 40)
    
    all_good = True
    
    if not test_imports():
        all_good = False
    
    if not test_azure_credentials():
        all_good = False
        print("\nTo set Azure credentials:")
        print("export AZURE_SPEECH_KEY='your-key-here'")
        print("export AZURE_SPEECH_REGION='your-region-here'")
    
    if not test_audio():
        all_good = False
    
    print("\n" + "=" * 40)
    if all_good:
        print("✓ All tests passed! You're ready to use the voice transcriber.")
    else:
        print("✗ Some tests failed. Please fix the issues above.")
        sys.exit(1)

if __name__ == "__main__":
    main()