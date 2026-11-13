"""Agent model: an agent is a bundle of system prompt + skills + runtime + memory.

The AgentConfig dataclass (blacksun.config) is the declarative half; AgentRegistry
(blacksun.agents.registry) turns it into prompts and native subagent files.
"""

from blacksun.config import AgentConfig, LoopConfig

__all__ = ["AgentConfig", "LoopConfig"]
