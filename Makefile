site:
	@node deploy.js

deploy:
	@node deploy.js
	@ghp-import _site

publish:
	@git push origin gh-pages

.PHONY: site deploy publish
