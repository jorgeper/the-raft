"""Agent model: an agent is a bundle of system prompt + skills + runtime + memory.

The AgentConfig dataclass (studio.config) is the declarative half; AgentRegistry
(studio.agents.registry) turns it into prompts and native subagent files.
"""

from studio.config import AgentConfig, LoopConfig

__all__ = ["AgentConfig", "LoopConfig"]
