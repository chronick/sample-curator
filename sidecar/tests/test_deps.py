"""Tests for sample_curation_api.deps (vault-347l)."""

from sample_curation_api import deps
from sample_curation_api.deps import EXTRA_MODULES, deps_status
from sample_curation_api.handlers import HANDLERS


class TestDepsStatusShape:
    def test_returns_extras_key(self):
        result = deps_status()
        assert "extras" in result
        assert isinstance(result["extras"], dict)

    def test_covers_all_known_extras(self):
        result = deps_status()
        assert set(result["extras"].keys()) == set(EXTRA_MODULES.keys())

    def test_each_extra_has_installed_and_missing(self):
        result = deps_status()
        for name, status in result["extras"].items():
            assert "installed" in status, f"{name} missing 'installed'"
            assert "missing" in status, f"{name} missing 'missing'"
            assert isinstance(status["installed"], bool)
            assert isinstance(status["missing"], list)

    def test_installed_flag_consistent_with_missing(self):
        """If `missing` is non-empty, `installed` must be False (and vice versa)."""
        result = deps_status()
        for name, status in result["extras"].items():
            if status["missing"]:
                assert status["installed"] is False, f"{name}: missing items but installed=True"
            else:
                assert status["installed"] is True, f"{name}: empty missing but installed=False"


class TestDepsStatusDetection:
    def test_all_modules_missing_marks_extra_uninstalled(self, monkeypatch):
        # Force every find_spec call to return None — simulates a clean
        # bundled sidecar where no ML extras have been installed.
        monkeypatch.setattr(deps, "_module_present", lambda name: False)
        result = deps_status()
        for name, status in result["extras"].items():
            assert status["installed"] is False
            assert status["missing"] == EXTRA_MODULES[name]

    def test_partial_install_lists_only_missing(self, monkeypatch):
        # Pretend torch + transformers are installed but laion_clap and
        # torchvision aren't — should mark `embedding` uninstalled with
        # only the missing two listed.
        present = {"torch", "transformers"}
        monkeypatch.setattr(deps, "_module_present", lambda name: name in present)

        result = deps_status()
        embedding = result["extras"]["embedding"]
        assert embedding["installed"] is False
        assert set(embedding["missing"]) == {"laion_clap", "torchvision"}

    def test_full_install_marks_extra_installed(self, monkeypatch):
        monkeypatch.setattr(deps, "_module_present", lambda name: True)
        result = deps_status()
        for name, status in result["extras"].items():
            assert status["installed"] is True
            assert status["missing"] == []


class TestExtraModulesContract:
    """Pin known-correct module sets for each extra so the deps panel
    doesn't drift from what the runtime actually needs."""

    def test_llm_hf_does_not_require_accelerate(self):
        # llm.py deliberately omits ``device_map="cpu"`` to avoid the
        # accelerate dep — surfacing it as required would mislead users
        # into installing a library they don't need. If a future change
        # re-adds accelerate, this test should fail and EXTRA_MODULES
        # should be updated alongside the runtime change.
        assert "accelerate" not in EXTRA_MODULES["llm_hf"]
        assert set(EXTRA_MODULES["llm_hf"]) == {"transformers", "torch"}

    def test_embedding_includes_clap_substrate(self):
        assert set(EXTRA_MODULES["embedding"]) >= {"transformers", "torch", "laion_clap"}

    def test_transcription_uses_faster_whisper_module_name(self):
        # Package name is `faster-whisper` but the module imports as `faster_whisper`
        assert "faster_whisper" in EXTRA_MODULES["transcription"]
        assert "faster-whisper" not in EXTRA_MODULES["transcription"]


class TestDepsHandlerRegistration:
    def test_deps_status_registered(self):
        assert "deps_status" in HANDLERS
        assert HANDLERS["deps_status"] is deps_status
