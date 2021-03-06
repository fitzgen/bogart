
var assert = require("test/assert");
var bogart = require("bogart");
var MockRequest = require("jack/mock").MockRequest;

bogart.baseApp.log = function() {};


/**
 * Test a basic GET route calls the handler function
 */
exports.testGetRouteCallsHandler = function() {
    var indexPageCount = 0;

    GET("/", function() {
        indexPageCount += 1;
        return this.response.finish();
    });

    var env = MockRequest.envFor("get", "/", {});
    bogart.app(env);
    assert.isTrue(indexPageCount == 1, "IndexPage function should've been called '1' time, was called '" + indexPageCount + "' times");
};

/**
 * Test that regex routes produce a single splat variable in the params array when
 * the route contains a single matcher
 */
exports.testSplatWithSingleGroupCapture = function() {
    var params = null;

    GET(/\/(.*)/g, function() {
        params = this.params;
        return this.response.finish();
    });

    var env = MockRequest.envFor("GET", "/test/with/slashes", {});
    bogart.app(env);

    assert.isTrue(params["splat"] == "test/with/slashes",
            "params['splat'] should be /test/with/slashes, was " + params["splat"]);
};

/**
 * Test that noConflict() removes globals
 */
exports.testNoConflictRemovesGlobals = function() {
    Bogart.noConflict();

    assert.isTrue(typeof GET == "undefined", "get should be undefined");
    assert.isTrue(typeof POST == "undefined", "post should be undefined");
    assert.isTrue(typeof PUT == "undefined", "put should be undefined");
    assert.isTrue(typeof DELETE == "undefined", "del should be undefined");
    assert.isTrue(typeof route == "undefined", "route should be undefined");
};