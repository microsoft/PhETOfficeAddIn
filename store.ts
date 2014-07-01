module MixAppBrowser {
    export interface AppDataDriver {
        loadCategories(maxDepth: number): JQueryPromise<AppContent[]>;

        loadCategory(parentId: string, searchText: string): JQueryPromise<AppContent[]>;

        get(id: string): JQueryPromise<AppContent>;

        buildConfiguration(content: AppContent): Labs.Core.IConfiguration;

        getIdFromConfiguration(configuration: Labs.Core.IConfiguration) : string;
    }

    // Top-level ndoes in a topic tree
    export interface AppContent {
        id: string;
        type: string;
        title: string;
        providerId: string;
        readableId: string;
        youtubeId: string;
        durationInSec: number;
        thumbnailUrl: string;
        contentUrl: string;
        children: AppContent[];
    }    
    
    /**
     * Helper method to create a ILabCallback for the given jQuery deferred object
     */
    function createCallback<T>(deferred: JQueryDeferred<T>): Labs.Core.ILabCallback<T> {
        return (err, data) => {
            if (err) {
                deferred.reject(err);
            }
            else {
                deferred.resolve(data);
            }
        };
    }

    class MixAppBrowserViewModel {
        view: KnockoutComputed<string>;        

        contentType: KnockoutObservable<string>;
        domains: KnockoutObservableArray<AppContent>;
        activeDomain: KnockoutObservable<AppContent>;
        item: KnockoutObservable<AppContent>;
        searchText: KnockoutObservable<string>;
        activeItemUrl: KnockoutComputed<string>;

        // The view the app is currently within
        private _appView: KnockoutObservable<string> = ko.observable();
        // The view selected by the user
        private _userView: KnockoutObservable<string> = ko.observable("edit");

        private _labEditor: Labs.LabEditor;
        private _labInstance: Labs.LabInstance;
        private _links: AppDataDriver;        
        private _modeSwitchP: JQueryPromise<void> = $.when();

        constructor(links: AppDataDriver, initialMode: Labs.Core.LabMode) {
            this._links = links;

            // Setup knockout observables                         
            this.domains = ko.observableArray([]);
            this.activeDomain = ko.observable();
            this.item = ko.observable();
            this.searchText = ko.observable("");

            this.activeItemUrl = ko.computed(()=> {
                var item = this.item();
                return item ? item.providerId : null;
            });

            this.view = ko.computed(()=> {
                var appView = this._appView();
                var userView = this._userView();

                if (appView === "view" || (appView === "edit" && userView === "view")) {
                    return "viewTemplate";
                }
                else if (appView === "edit") {
                    return "editTemplate";
                } else {
                    return "loadingTemplate";
                }
            });

            // Events coming from the lab host
            Labs.on(Labs.Core.EventTypes.ModeChanged, (data) => {
                var modeChangedEventData = <Labs.Core.ModeChangedEventData> data;
                this.switchToMode(Labs.Core.LabMode[modeChangedEventData.mode]);
                return $.when();
            });

            Labs.on(Labs.Core.EventTypes.Activate, (data) => {                
            });

            Labs.on(Labs.Core.EventTypes.Deactivate, (data) => {                
            });

            // Set the initial mode
            this.switchToMode(initialMode);
        }

        switchToMode(mode: Labs.Core.LabMode) {
            // wait for any previous mode switch to complete before performing the new one
            this._modeSwitchP = this._modeSwitchP.then(() => {
                var switchedStateDeferred = $.Deferred();

                // End any existing operations
                if (this._labInstance) {
                    this._labInstance.done(createCallback(switchedStateDeferred));
                }
                else if (this._labEditor) {
                    this._labEditor.done(createCallback(switchedStateDeferred));
                } else {
                    switchedStateDeferred.resolve();
                }

                // and now switch the state
                return switchedStateDeferred.promise().then(() => {
                    this._labEditor = null;
                    this._labInstance = null;

                    if (mode === Labs.Core.LabMode.Edit) {
                        return this.switchToEditMode();
                    } else {
                        return this.switchToViewMode();
                    }
                });
            });
        }

        private switchToEditMode(): JQueryPromise<void> {
            var editLabDeferred = $.Deferred();
            Labs.editLab(createCallback(editLabDeferred));

            return editLabDeferred.promise().then((labEditor) => {
                this._labEditor = labEditor;
                this._appView("edit");

                var configurationDeferred = $.Deferred();
                this._labEditor.getConfiguration(createCallback(configurationDeferred));
                return configurationDeferred.promise().then((configuration) => {
                    if (configuration) {
                        var id = this._links.getIdFromConfiguration(configuration);

                        // This should just be a method to show
                        this._links.get(id).done((item: AppContent) => {
                            this._userView("view");
                            this.item(item);
                        });
                    } else {                        
                        this.loadDomain();
                    }
                });
            });
        }
        
        private loadDomain(): JQueryPromise<void> {
            if (this.domains().length > 0) {
                return $.when();
            }

            return this._links.loadCategories(2).then((domains) => {
                this.domains(domains);
                this.setActiveDomain(domains[0]);
            });
        }

        private setActiveDomain(domain: AppContent) {
            var clonedDomain = $.extend(true, {}, domain);
            clonedDomain.children.forEach((category) => { category.children = [] });
            this.activeDomain(clonedDomain);

            $.each(clonedDomain.children, (index, category) => {
                this._links.loadCategory(
                    category.providerId,
                    this.searchText()).then((list) => {
                        category.children = list;
                        // force a re-render of the page by updating the root binding
                        // TODO replace this with view models for sub items
                        this.activeDomain(this.activeDomain());
                    });
            });
        }

        private switchToViewMode(): JQueryPromise<void> {
            var takeLabDeferred = $.Deferred();
            Labs.takeLab(createCallback(takeLabDeferred));
            return takeLabDeferred.promise().then((labInstance) => {
                this._labInstance = labInstance;                
                this.loadItem(labInstance);                
            });
        }

        private loadItem(labInstance: Labs.LabInstance) {
            var activityComponent = <Labs.Components.ActivityComponentInstance> this._labInstance.components[0];

            this._links.get(activityComponent.component.data.id).done((item) => {
                var attemptsDeferred = $.Deferred();
                activityComponent.getAttempts(createCallback(attemptsDeferred));
                var attemptP = attemptsDeferred.promise().then((attempts) => {
                    var currentAttemptDeferred = $.Deferred();
                    if (attempts.length > 0) {
                        currentAttemptDeferred.resolve(attempts[attempts.length - 1]);
                    } else {
                        activityComponent.createAttempt(createCallback(currentAttemptDeferred));
                    }

                    return currentAttemptDeferred.then((currentAttempt: Labs.Components.ActivityComponentAttempt) => {
                        var resumeDeferred = $.Deferred();
                        currentAttempt.resume(createCallback(resumeDeferred));
                        return resumeDeferred.promise().then(() => {
                            return currentAttempt;
                        });
                    });
                });

                return attemptP.then((attempt: Labs.Components.ActivityComponentAttempt) => {
                    var completeDeferred = $.Deferred();
                    if (attempt.getState() !== Labs.ProblemState.Completed) {
                        attempt.complete(createCallback(completeDeferred));
                    } else {
                        completeDeferred.resolve();
                    }

                    this._appView("view");
                    this.item(item);                                       
                                        
                    return completeDeferred.promise();
                });
            });
        }                                                             

        //
        // Action invoked when the user clicks on the insert button on the details page
        //
        onInsertClick() {
            var configuration = this._links.buildConfiguration(this.item());
            if (this._labEditor) {
                this._labEditor.setConfiguration(configuration, (err, unused) => {                    
                    this._userView("view");                    
                });
            }
        }

        //
        // Method invoked when the user clicks on a selection and wants to move to the details page
        // 
        moveToDetailPage(content: AppContent) {
            this._links.get(content.id).then((item: AppContent) => {
                this.item(item);                
            });
        }

        //
        // Moves back to the select page
        //
        moveToSelectPage() {
            this.item(null);            
        }

        //
        // Callback inoked when a search occurs
        //
        search() {
            this.setActiveDomain(this.activeDomain());
        }
    }

    export function initialize(driver: AppDataDriver) {
        $(document).ready(() => {
            // Initialize Labs.JS
            Labs.connect((err, connectionResponse) => {
                var viewModel = new MixAppBrowserViewModel(driver, connectionResponse.mode);
                ko.applyBindings(viewModel);
            });
        });
    }
}
