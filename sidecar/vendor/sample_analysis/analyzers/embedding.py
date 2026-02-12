"""CLAP audio embedding analyzer.

This module provides audio embeddings using CLAP (Contrastive Language-Audio Pretraining)
for similarity search and semantic audio analysis.
"""

import time
from pathlib import Path

from sample_analysis.analyzers import register_analyzer
from sample_analysis.analyzers.base import BaseAnalyzer, ModelNotAvailableError
from sample_analysis.models import EmbeddingResult


@register_analyzer("embedding")
class EmbeddingAnalyzer(BaseAnalyzer):
    """CLAP embedding extractor.

    Extracts audio embeddings using CLAP which can be used for:
    - Similarity search between samples
    - Text-to-audio matching
    - Clustering and organization

    Note: Requires laion-clap and torch to be installed.

    Example:
        >>> analyzer = EmbeddingAnalyzer()
        >>> result = analyzer.analyze("sample.wav")
        >>> print(f"Embedding dimension: {result.dimension}")
    """

    def __init__(self, *args, model_name: str = "630k-audioset-fusion-best", **kwargs):
        """Initialize the embedding analyzer.

        Args:
            model_name: CLAP model variant to use.
            *args: Passed to BaseAnalyzer.
            **kwargs: Passed to BaseAnalyzer.
        """
        super().__init__(*args, **kwargs)
        self.model_name = model_name
        self._model = None

    @property
    def name(self) -> str:
        return "embedding"

    def is_available(self) -> bool:
        """Check if laion-clap and torch are installed."""
        try:
            import laion_clap
            import torch
            return True
        except ImportError:
            return False

    def _load_model(self):
        """Lazy load the CLAP model."""
        if self._model is not None:
            return

        if not self.is_available():
            raise ModelNotAvailableError(
                "Embedding analyzer requires laion-clap and torch. "
                "Install with: pip install laion-clap torch"
            )

        import laion_clap

        self._model = laion_clap.CLAP_Module(enable_fusion=True)
        self._model.load_ckpt()

    def analyze(
        self,
        audio_path: Path,
        **kwargs,
    ) -> EmbeddingResult:
        """Extract CLAP embedding from audio.

        Args:
            audio_path: Path to audio file.
            **kwargs: Additional arguments (unused).

        Returns:
            EmbeddingResult with embedding vector.

        Raises:
            ModelNotAvailableError: If laion-clap is not installed.
        """
        if not self.is_available():
            raise ModelNotAvailableError(
                "Embedding analyzer requires laion-clap and torch. "
                "Install with: pip install laion-clap torch"
            )

        start_time = time.time()

        # Lazy load model
        self._load_model()

        # Get audio embedding
        embedding = self._model.get_audio_embedding_from_filelist(
            [str(audio_path)],
            use_tensor=False,
        )

        # Convert to list
        vector = embedding[0].tolist()

        duration = time.time() - start_time

        return EmbeddingResult(
            model=self.model_name,
            vector=vector,
            dimension=len(vector),
        )

    def get_text_embedding(self, text: str) -> list[float]:
        """Get embedding for text (for text-audio similarity).

        Args:
            text: Text description to embed.

        Returns:
            Embedding vector as list of floats.
        """
        self._load_model()

        embedding = self._model.get_text_embedding([text], use_tensor=False)
        return embedding[0].tolist()

    def similarity(self, audio_path: Path, text: str) -> float:
        """Calculate similarity between audio and text.

        Args:
            audio_path: Path to audio file.
            text: Text description to compare.

        Returns:
            Cosine similarity score.
        """
        import numpy as np

        audio_emb = self.analyze(audio_path).vector
        text_emb = self.get_text_embedding(text)

        # Cosine similarity
        audio_arr = np.array(audio_emb)
        text_arr = np.array(text_emb)

        similarity = np.dot(audio_arr, text_arr) / (
            np.linalg.norm(audio_arr) * np.linalg.norm(text_arr)
        )

        return float(similarity)
