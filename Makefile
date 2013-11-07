all: bee


node_modules: package.json
	@npm install


bee: node_modules lib/*


#
# Tests
#
test: bee
	@HIVE_RELOAD_SCRIPTS=1 mocha
test-fast : bee
	@HIVE_RELOAD_SCRIPTS=1 mocha -i --grep slow


#
# Coverage
#
lib-cov: clean-cov
	@jscoverage --no-highlight lib lib-cov

test-cov: lib-cov
	@HIVE_RELOAD_SCRIPTS=1 BEE_COV=1 mocha \
		--require ./test/globals \
		--reporter html-cov \
		> coverage.html

#
# Clean up
#

clean: clean-node clean-cov

clean-node:
	@rm -rf node_modules

clean-cov:
	@rm -rf lib-cov
	@rm -f coverage.html

.PHONY: all
.PHONY: test test-fast
