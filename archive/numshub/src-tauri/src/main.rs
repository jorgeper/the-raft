//! Numshub entry point. With no arguments this launches the menu-bar app;
//! subcommands expose the pipeline headlessly for the validation harness
//! (SPEC §8: I1 transcribes a fixture through the REAL engine + cleanup, I2
//! exercises cleanup-only mode).

#![cfg_attr(not(test), windows_subsystem = "windows")]

use clap::{Parser, Subcommand};
use numshub_lib::cleanup::{clean, CleanOptions};
use numshub_lib::registry::EngineFamily;
use std::io::Read;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "numshub", about = "Fast, fully-local voice dictation")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Transcribe a WAV file through the real engine + cleanup pipeline.
    Transcribe {
        /// Path to the model file (whisper GGUF) or directory (parakeet).
        #[arg(long)]
        model_path: PathBuf,
        /// Engine family: whisper | parakeet.
        #[arg(long)]
        engine: String,
        /// Print the raw transcript without the cleanup pass.
        #[arg(long)]
        raw: bool,
        /// 16 kHz (or any rate) WAV file to transcribe.
        wav: PathBuf,
    },
    /// Read text on stdin, apply the deterministic cleanup pass, print it.
    Clean {
        /// Disable repeated-word collapsing.
        #[arg(long)]
        keep_repeats: bool,
    },
    /// Measure cleanup-filter latency on a 1,000-word transcript (SPEC §7).
    BenchClean,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        None => {
            numshub_lib::run();
            Ok(())
        }
        Some(Command::Transcribe {
            model_path,
            engine,
            raw,
            wav,
        }) => {
            let family = match engine.as_str() {
                "whisper" => EngineFamily::Whisper,
                "parakeet" => EngineFamily::Parakeet,
                other => anyhow::bail!("unknown engine '{other}' (whisper|parakeet)"),
            };
            let samples = numshub_lib::stt::read_wav_16k_mono(&wav)?;
            let t0 = std::time::Instant::now();
            let mut model = numshub_lib::stt::LoadedModel::load_path(family, &model_path)?;
            let load_time = t0.elapsed();
            let t1 = std::time::Instant::now();
            let text = model.transcribe(&samples)?;
            let infer_time = t1.elapsed();
            eprintln!(
                "model load: {load_time:?}, inference: {infer_time:?}, audio: {:.1}s",
                samples.len() as f64 / 16_000.0
            );
            if raw {
                println!("{text}");
            } else {
                println!("{}", clean(&text, &CleanOptions::default()));
            }
            Ok(())
        }
        Some(Command::Clean { keep_repeats }) => {
            let mut input = String::new();
            std::io::stdin().read_to_string(&mut input)?;
            let opts = CleanOptions {
                collapse_repeats: !keep_repeats,
                ..Default::default()
            };
            println!("{}", clean(&input, &opts));
            Ok(())
        }
        Some(Command::BenchClean) => {
            // 1,000-word transcript with fillers sprinkled in.
            let mut words = Vec::with_capacity(1000);
            for i in 0..1000 {
                words.push(match i % 13 {
                    0 => "um",
                    5 => "uh",
                    9 => "hmm",
                    _ => "transcription",
                });
            }
            let text = words.join(" ");
            let opts = CleanOptions::default();
            // Warm up, then measure.
            for _ in 0..10 {
                std::hint::black_box(clean(&text, &opts));
            }
            let runs = 100;
            let t0 = std::time::Instant::now();
            for _ in 0..runs {
                std::hint::black_box(clean(&text, &opts));
            }
            let per_run = t0.elapsed() / runs;
            println!("cleanup(1000 words): {per_run:?} per run");
            Ok(())
        }
    }
}
