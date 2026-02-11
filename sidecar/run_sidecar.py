#!/usr/bin/env python3
"""Run the sample curation API sidecar."""

import sys
from pathlib import Path

# Add the sidecar package to the path
sidecar_dir = Path(__file__).parent
sys.path.insert(0, str(sidecar_dir))

# Add vendored packages (sample_analysis, sample_library) to the path
vendor_dir = sidecar_dir / "vendor"
sys.path.insert(0, str(vendor_dir))

from sample_curation_api import main

if __name__ == "__main__":
    main()
