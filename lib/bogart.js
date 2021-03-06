var Jack = require("jack"),
    Session = require("jack/session").Session,
    Request = Jack.Request,
    util = require("util"),
    system = require("system"),
    logger = require("bogart-log"),
    PATH_REPLACER = "([^\.\/\?]+)",
    PATH_NAME_MATCHER = /:([\w\d]+)/g,
    ROUTE_VERBS = ['GET','POST','PUT','DELETE'],
    Bogart = exports;

Bogart.Plugins = require("./bogart/plugin/all");

Bogart.Version = "0.0.2";

/**
 * Builds a Bogart Application
 * 
 * @param options
 * @constructor
 */
Bogart.App = function(options) {
    options = options || {};

    var routes = {};
    var appFn;

    this.publish(Bogart.App.Event.BEFORE_INIT, this, options);

    if (options instanceof Function){
        appFn = options;
    } else {
        appFn = options.init || function() {};
    }

    this.layout = this.layout || "";

    /**
     * Property accessor for the Log that this Bogart.App uses.  If a value is specified, sets the logger to use to
     * the logger specified.  If no logger is specified, returns the current logger.
     * @param {Object} val Logger to use for this Bogart App.  If val is not present, returns the current logger.
     * @returns The current logger if val is undefined.prototype
     * @type Object
     */
    this.log = function(val){
        if (val != undefined)
            logger = val;
        else
            return logger;
    };

    /**
     * Register a route
     * @param verb Http verb e.g. 'get','post','put','delete'
     * @param path Path beginning with '/' for the route
     * @param callback Route handler function to execute when the route is visited
     * @returns route
     */
    this.route = function(verb, path, callback) {
        if (ROUTE_VERBS.indexOf(verb.toUpperCase()) == -1)
            throw new Error("Unrecognized verb: " + verb);

        verb = verb.toUpperCase();

        // turn the path into a regular expression
        var paramNames = [];

        if (path.constructor == String) {
            while (true) {
                var pathMatch = PATH_NAME_MATCHER.exec(path);
                if (pathMatch != null) {
                    paramNames.push(pathMatch[1]);
                }
                else {
                    break;
                }
            }
            path = path
                    .replace(/\./, "\\.")
                    .replace(PATH_NAME_MATCHER, PATH_REPLACER) + "($|(\\?.+)$)";
            path = new RegExp(path);
        }

        var r = {verb: verb, path: path, callback: callback, paramNames: paramNames};

        if (typeof routes[verb] == 'undefined' || routes[verb].length == 0) {
            // create the routes array if it does not exist
            routes[verb] = [r];
        } else {
            routes[verb].push(r);
        }

        return r;
    };

    /**
     * Find the route handler registered to 'verb' and 'path' for this Bogart App.
     * @param verb Http verb e.g. 'get','put','post','delete'
     * @param path Path of the route to find
     * @private
     */
    this.getRouteHandler = function(verb, path) {
        var routed = false;

        this.publish("before_lookup_route", verb, path);
        if (typeof routes[verb] != 'undefined'){
            for (var i=0;i<routes[verb].length;++i) {
                var route = routes[verb][i];
                if (path.match(route.path)) {
                    routed = route;
                }
            }
        }
        this.publish("after_lookup_route", routed, verb, path);

        return routed;
    };

    /**
     * Locate and invoke the route handler corresponding to the verb and path parameters.
     * @param {String} verb Http verb e.g. 'get','put','post','delete'
     * @param {String} path Path to the route
     * @param {Object} params Route parameters
     */
    this.handleRoute = function(verb, path, params) {
        var self = this,
            pathParams = null;

        params = params || {};

        var route = this.getRouteHandler(verb, path);

        if (!route) {
            this.response.status = 404;
            this.response.write("No route found that matches '" + verb + ": " + path + "'");
            return this.response.finish();
        }

        pathParams = route.path.exec(path);
        if (pathParams) {
            pathParams.shift();

            pathParams.forEach(function(paramValue, indx, array) {
                paramValue = unescape(paramValue);
                if (route.paramNames.length - 1 >= indx) {
                    params[route.paramNames[indx]] = paramValue;
                } else if (paramValue != undefined) {
                    params["splat"] = params["splat"] || [];
                    params["splat"].push(paramValue);
                }
            });

            if (typeof params["splat"] !== "undefined" && params["splat"].length == 1) {
                params["splat"] = params["splat"][0];
            }

            util.update(params, this.request.params());
        }

        var viewsRoot = self.viewsRoot;
        if (viewsRoot && !viewsRoot.match(/\/$/g))
            viewsRoot += "/";

        var routeContext = new RouteHandlerContext(self.env, self.response, {
            verb: verb,
            params: params,
            layout: self.layout,
            viewsRoot: viewsRoot
        });

        this.publish("before_execute_route", this, routeContext);
        var result =  route.callback.call(routeContext);
        this.publish("after_execute_route", routeContext);

        return result || self.response.finish();
    };

    addRouteMethods(this);

    appFn.call(this);

    /**
     * Takes an environment and handles the request
     * @param env JSGI environment
     * @private
     */
    var app = function(env) {
        var verb = env["REQUEST_METHOD"].toUpperCase();
        var routeResponse, appResponse, msg;

        this.env = env;
        this.request = new Jack.Request(env);
        this.response = new Jack.Response();
        this.response.headers["Content-Type"] = "text/html";

        try {
            routeResponse = this.handleRoute(verb, this.request.relativeURI());
        }
        catch (err) {
            this.publish(Bogart.App.Event.ROUTE_ERROR, this, err, { verb: verb, path: this.request.relativeURI() });
            throw err;
        }

        return routeResponse;
    };

    app = app.bind(this);

    return Jack.MethodOverride(app);
};

var EjsPlugin = new Bogart.Plugins.Ejs();
//EjsPlugin.follow(function() {
//    var args = Array.prototype.slice.call(arguments);
//    Bogart.App.prototype.publish(args);
//});
require("observable").mixin(Bogart.App.prototype, {
    plugins: [
        new Bogart.Plugins.PublishEvents(),
        EjsPlugin
    ]
});

["addPlugin","removePlugin","subscribeTo","unsubscribe","plugins","removeAllPlugins","unsubscribeAll"].forEach(function(method) {
    Bogart.App[method] = Bogart.App.prototype[method];
});

/**
 * Context in which to execute a route handler.
 * @param {Object} env JSGI environment
 * @param {Jack#Response} response
 * @param {Object} options
 * @constructor
 */
var RouteHandlerContext = exports.RouteHandlerContext = function(env, response, options) {
    if (env == undefined)
        throw new Error("Argument undefined error: expected 'env'");

    options = options || {};

    this.env = env;
    this.request = new Request(env);
    this.response = response;
    this.verb = options.verb || "GET";
    this.params = options.params || {};

    this.session = new Session(env) || {};
    this.flash = new Session(env).flash || {};
    this.cookies = this.request.cookies();
};

RouteHandlerContext.prototype = {
    
    jsontemplate: function(viewName, model, options){
        var data = undefined;
        var self = this;

        model = util.deepCopy(model) || {};

        if (typeof model.model != undefined && model.model) {
            data = model;
        } else {
            data = { model: model };
        }

        var shouldFinishResponse = true;

        options = options || {};
        if (options.shouldFinishResponse == undefined) {
            shouldFinishResponse = true;
        } else {
            shouldFinishResponse = options.shouldFinishResponse;
        }

        var defaultValue = function(model, name){
            if (typeof model == undefined || typeof model == null) return "";
            if (typeof name == undefined || typeof name == null) return "";
            return model[name] || "";
        };

        var defaultValues = {};

        for (var key in model) {
            if (typeof model[key] == undefined || model[key] == null) {
                defaultValues[key] = defaultValue(model, key);
            } else {
                defaultValues[key] = model[key];
            }
        }

        util.update(data, defaultValues);

        var fs = require("file");
        var viewsDirectory = fs.path(require.main).dirname();
        var viewPath = fs.path(viewsDirectory.toString() + "/views/" + viewName + ".html.json");
        var rawTemplate = fs.read(viewPath, "+r");

        var raw = require("jsontemplate").jsontemplate.Template(new String(rawTemplate), { meta: options.meta || "{}" }).expand(data);

        if (shouldFinishResponse) {
            self.response.write(raw);
            return self.response.finish();
        }

        return raw;
    },
    /**
     * Takes an object and returns a JSGI response containing a JSON representation of the object.
     * @param {Object} obj Object to coerce into a JSON string
     * @returns JSGI response containing the JSON response
     */
    json: function(obj){
        this.response.write(JSON.stringify(obj));
        return this.response.finish();
    },
    /**
     * JSGI redirect to a uri
     * @param {String} uri Where to redirect
     * @returns JSGI redirect response
     */
    redirectTo: function(uri) {
        this.response.redirect(uri);
        return this.response.finish();
    },
    /**
     * JSGI response with body containing a string.
     * @param {String} str Text for the body of the response
     */
    text: function(str){
        this.response.write(str);
        return this.response.finish();
    }
};

function addRouteMethods(obj){
    ROUTE_VERBS.forEach(function(verb){
        obj[verb] = function(path, callback) {
            return obj.route(verb, path, callback);
        };
    });
};

var appEvents = ["before_init","before_lookup_route","after_lookup_route","before_execute_route","after_execute_route", "route_error"];

Bogart.App.Event = {
    BEFORE_INIT: "before_init",
    BEFORE_EXECUTE_ROUTE: "before_execute_route",
    AFTER_EXECUTE_ROUTE: "after_execute_route",
    ROUTE_ERROR: "route_error"
};
