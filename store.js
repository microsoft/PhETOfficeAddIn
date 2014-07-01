var MixAppBrowser;
(function (MixAppBrowser) {
    /**
    * Helper method to create a ILabCallback for the given jQuery deferred object
    */
    function createCallback(deferred) {
        return function (err, data) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(data);
            }
        };
    }

    var MixAppBrowserViewModel = (function () {
        function MixAppBrowserViewModel(links, initialMode) {
            var _this = this;
            // The view the app is currently within
            this._appView = ko.observable();
            // The view selected by the user
            this._userView = ko.observable("edit");
            this._modeSwitchP = $.when();
            this._links = links;

            // Setup knockout observables
            this.domains = ko.observableArray([]);
            this.activeDomain = ko.observable();
            this.item = ko.observable();
            this.searchText = ko.observable("");

            this.activeItemUrl = ko.computed(function () {
                var item = _this.item();
                return item ? item.providerId : null;
            });

            this.view = ko.computed(function () {
                var appView = _this._appView();
                var userView = _this._userView();

                if (appView === "view" || (appView === "edit" && userView === "view")) {
                    return "viewTemplate";
                } else if (appView === "edit") {
                    return "editTemplate";
                } else {
                    return "loadingTemplate";
                }
            });

            // Events coming from the lab host
            Labs.on(Labs.Core.EventTypes.ModeChanged, function (data) {
                var modeChangedEventData = data;
                _this.switchToMode(Labs.Core.LabMode[modeChangedEventData.mode]);
                return $.when();
            });

            Labs.on(Labs.Core.EventTypes.Activate, function (data) {
            });

            Labs.on(Labs.Core.EventTypes.Deactivate, function (data) {
            });

            // Set the initial mode
            this.switchToMode(initialMode);
        }
        MixAppBrowserViewModel.prototype.switchToMode = function (mode) {
            var _this = this;
            // wait for any previous mode switch to complete before performing the new one
            this._modeSwitchP = this._modeSwitchP.then(function () {
                var switchedStateDeferred = $.Deferred();

                if (_this._labInstance) {
                    _this._labInstance.done(createCallback(switchedStateDeferred));
                } else if (_this._labEditor) {
                    _this._labEditor.done(createCallback(switchedStateDeferred));
                } else {
                    switchedStateDeferred.resolve();
                }

                // and now switch the state
                return switchedStateDeferred.promise().then(function () {
                    _this._labEditor = null;
                    _this._labInstance = null;

                    if (mode === Labs.Core.LabMode.Edit) {
                        return _this.switchToEditMode();
                    } else {
                        return _this.switchToViewMode();
                    }
                });
            });
        };

        MixAppBrowserViewModel.prototype.switchToEditMode = function () {
            var _this = this;
            var editLabDeferred = $.Deferred();
            Labs.editLab(createCallback(editLabDeferred));

            return editLabDeferred.promise().then(function (labEditor) {
                _this._labEditor = labEditor;
                _this._appView("edit");

                var configurationDeferred = $.Deferred();
                _this._labEditor.getConfiguration(createCallback(configurationDeferred));
                return configurationDeferred.promise().then(function (configuration) {
                    if (configuration) {
                        var id = _this._links.getIdFromConfiguration(configuration);

                        // This should just be a method to show
                        _this._links.get(id).done(function (item) {
                            _this._userView("view");
                            _this.item(item);
                        });
                    } else {
                        _this.loadDomain();
                    }
                });
            });
        };

        MixAppBrowserViewModel.prototype.loadDomain = function () {
            var _this = this;
            if (this.domains().length > 0) {
                return $.when();
            }

            return this._links.loadCategories(2).then(function (domains) {
                _this.domains(domains);
                _this.setActiveDomain(domains[0]);
            });
        };

        MixAppBrowserViewModel.prototype.setActiveDomain = function (domain) {
            var _this = this;
            var clonedDomain = $.extend(true, {}, domain);
            clonedDomain.children.forEach(function (category) {
                category.children = [];
            });
            this.activeDomain(clonedDomain);

            $.each(clonedDomain.children, function (index, category) {
                _this._links.loadCategory(category.providerId, _this.searchText()).then(function (list) {
                    category.children = list;

                    // force a re-render of the page by updating the root binding
                    // TODO replace this with view models for sub items
                    _this.activeDomain(_this.activeDomain());
                });
            });
        };

        MixAppBrowserViewModel.prototype.switchToViewMode = function () {
            var _this = this;
            var takeLabDeferred = $.Deferred();
            Labs.takeLab(createCallback(takeLabDeferred));
            return takeLabDeferred.promise().then(function (labInstance) {
                _this._labInstance = labInstance;
                _this.loadItem(labInstance);
            });
        };

        MixAppBrowserViewModel.prototype.loadItem = function (labInstance) {
            var _this = this;
            var activityComponent = this._labInstance.components[0];

            this._links.get(activityComponent.component.data.id).done(function (item) {
                var attemptsDeferred = $.Deferred();
                activityComponent.getAttempts(createCallback(attemptsDeferred));
                var attemptP = attemptsDeferred.promise().then(function (attempts) {
                    var currentAttemptDeferred = $.Deferred();
                    if (attempts.length > 0) {
                        currentAttemptDeferred.resolve(attempts[attempts.length - 1]);
                    } else {
                        activityComponent.createAttempt(createCallback(currentAttemptDeferred));
                    }

                    return currentAttemptDeferred.then(function (currentAttempt) {
                        var resumeDeferred = $.Deferred();
                        currentAttempt.resume(createCallback(resumeDeferred));
                        return resumeDeferred.promise().then(function () {
                            return currentAttempt;
                        });
                    });
                });

                return attemptP.then(function (attempt) {
                    var completeDeferred = $.Deferred();
                    if (attempt.getState() !== Labs.ProblemState.Completed) {
                        attempt.complete(createCallback(completeDeferred));
                    } else {
                        completeDeferred.resolve();
                    }

                    _this._appView("view");
                    _this.item(item);

                    return completeDeferred.promise();
                });
            });
        };

        //
        // Action invoked when the user clicks on the insert button on the details page
        //
        MixAppBrowserViewModel.prototype.onInsertClick = function () {
            var _this = this;
            var configuration = this._links.buildConfiguration(this.item());
            if (this._labEditor) {
                this._labEditor.setConfiguration(configuration, function (err, unused) {
                    _this._userView("view");
                });
            }
        };

        //
        // Method invoked when the user clicks on a selection and wants to move to the details page
        //
        MixAppBrowserViewModel.prototype.moveToDetailPage = function (content) {
            var _this = this;
            this._links.get(content.id).then(function (item) {
                _this.item(item);
            });
        };

        //
        // Moves back to the select page
        //
        MixAppBrowserViewModel.prototype.moveToSelectPage = function () {
            this.item(null);
        };

        //
        // Callback inoked when a search occurs
        //
        MixAppBrowserViewModel.prototype.search = function () {
            this.setActiveDomain(this.activeDomain());
        };
        return MixAppBrowserViewModel;
    })();

    function initialize(driver) {
        $(document).ready(function () {
            // Initialize Labs.JS
            Labs.connect(function (err, connectionResponse) {
                var viewModel = new MixAppBrowserViewModel(driver, connectionResponse.mode);
                ko.applyBindings(viewModel);
            });
        });
    }
    MixAppBrowser.initialize = initialize;
})(MixAppBrowser || (MixAppBrowser = {}));
