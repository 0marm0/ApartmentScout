SEARCH ?= examples/nyc-2026
.PHONY: install demo test screenshots
install:
	pip install -e ".[dev]"
demo:
	apartmentscout serve --search $(SEARCH)
test:
	pytest -q
screenshots:
	apartmentscout build --search $(SEARCH) && python scripts/screenshots.py
