function joliApi(joli) {
    joli.saveRecord = function(table, items) {
        var i = 0;
        var new_count = 0;
        var updated_count = 0;
        items = joli.jsonParse(items);
        table = joli.models.get(table);

        // create transaction
        var transaction = new joli.transaction();
        transaction.begin();

        while(i < items.length) {
            if(!table.exists(items[i].id)) {
                table.newRecord(items[i]).save();
                new_count++;
            } else {
                // update the record
                var record = table.findOneById(items[i].id);
                record.fromArray(items[i]).save();
                updated_count++;
            }
            i++;
        }

        transaction.commit();

        Ti.App.fireEvent('joli.records.saved', {
            table: table.table,
            nb_new: new_count,
            nb_updated: updated_count
        });
    };

    joli.apimodel = function(options) {
        var defaults = {
            updateTime: 86400, // 1 day
            url: null
        };

        joli.extend.call(this, joli.model, options);
        joli.setOptions.call(this, options, defaults);
        this._api = new joli.apimodel.api({
            model: this
        });

        // override the extended model class
        joli.models.set(this.table, this);
    };

    joli.apimodel.prototype = {
        all: function(constraints) {
            var api_constraints = constraints;
            var where = constraints.where;
            var api_where = {};

            joli.each(api_constraints.where, function(value, field) {
                var field_parts = field.toString().split(' ');

                if(field_parts.length == 1 || (field_parts[1] == '=')) {
                    api_where[field_parts[0]] = value;
                }
            });

            api_constraints.where = api_where;
            var query_string = this.getQueryString(api_constraints);
            this.conditionnalUpdate(query_string);
            constraints.where = where;
            return this.parent.all(constraints);
        },
        conditionnalUpdate: function(query_string) {
            if(!query_string || ('null' == query_string) || (null == query_string)) {
                query_string = '';
            }

            if(this.hasToUpdate(query_string)) {
                this._api.get(query_string);
            }
        },
        count: function(constraints) {
            var api_constraints = constraints;
            var where = constraints.where;
            var api_where = {};

            joli.each(api_constraints.where, function(value, field) {
                var field_parts = field.toString().split(' ');

                if(field_parts.length == 1 || (field_parts[1] == '=')) {
                    api_where[field_parts[0]] = value;
                }
            });

            api_constraints.where = api_where;
            var query_string = this.getQueryString(api_constraints);
            this.conditionnalUpdate(query_string);
            constraints.where = where;
            return this.parent.count(constraints);
        },
        findBy: function(field, value) {
            var result = this.parent.findBy(field, value);

            if(!result) {
                var query_string = null;

                if(field && value) {
                    var where = {};
                    where[field] = value;
                    query_string = this.getQueryString({
                        where: where
                    });
                }

                this.conditionnalUpdate(query_string);
                return this.parent.findBy(field, value);
            }

            return result;
        },
        findOneBy: function(field, value) {
            var result = this.parent.findOneBy(field, value);

            if(!result) {
                var query_string = null;

                if(field && value) {
                    var where = {};
                    where[field] = value;
                    query_string = this.getQueryString({
                        where: where
                    });
                }

                this.conditionnalUpdate(query_string);
                result = this.parent.findOneBy(field, value);
            }

            return result;
        },
        forceReload: function(query_string) {
            if(!query_string || ('null' == query_string) || (null == query_string)) {
                query_string = '';
            }

            this._api.get(query_string);
        },
        getFirstUpdate: function(query_string) {
            if(query_string && (query_string.charAt(0) != '?')) {
                query_string = '?' + query_string;
            }

            if(!query_string || ('null' == query_string) || (null == query_string)) {
                query_string = '';
            }

            var first_update = new joli.query()
            .select('updated_at').from('table_updates').where('name = ?', this.table + query_string).order('updated_at asc').execute();

            if(first_update.length == 0) {
                return false;
            }

            return first_update[0].updated_at;
        },
        getQueryString: function(constraints) {
            var query_string = null;
            var query_string_params = [];

            if(constraints.where) {
                joli.each(constraints.where, function(value, key) {
                    query_string_params.push(key + '=' + value);
                });
            }

            if(query_string_params.length > 0) {
                query_string = '?' + query_string_params.join('&');
            }

            if(!query_string || ('null' == query_string) || (null == query_string)) {
                query_string = '';
            }

            return query_string;
        },
        hasToUpdate: function(query_string) {
            if(query_string && (query_string.charAt(0) != '?')) {
                query_string = '?' + query_string;
            }

            if(!query_string || ('null' == query_string) || (null == query_string)) {
                query_string = '';
            }

            var last_update = new joli.query().select('updated_at').from('table_updates').where('name = ?', this.table + query_string).order('updated_at desc').execute();

            if(last_update.length == 0) {
                return true;
            }

            var now = new Date().getTime();
            return (last_update[0].updated_at < now - this.options.updateTime * 1000);
        },
        markUpdated: function(query_string) {
            if(query_string && (query_string.charAt(0) != '?')) {
                query_string = '?' + query_string;
            }

            if(!query_string || ('null' == query_string) || (null == query_string)) {
                query_string = '';
            }

            var now = new Date().getTime();
            var q = new joli.query().insertInto('table_updates').values({
                name: this.table + query_string,
                updated_at: now
            });
            q.execute();
            Ti.App.fireEvent('joli.records.markedUpdated', {
                table: this.table
            });
        },
        newRecord: function(values, remote) {
            var record = this.parent.newRecord(values);

            // override the extended model class in the record references
            record._options.table = this;

            if(remote) {
                record._metadata.remote = remote;
            }

            return record;
        },
        save: function(data) {
            if(data.data.length === 0) {
                return;
            }

            if(data.metadata.remote) {
                // push the data remotely, it will be saved locally when the service
                // aknowlodges the write
                if(data.originalData) {
                    // existing record
                    this._api.put(JSON.stringify(data.data));
                } else {
                    // new record
                    delete data.data.id;
                    this._api.post(JSON.stringify(data.data));
                }

                // result is null in that case, as xhr calls are asynchronous
                // it is up to the developer to hook on joli.records.saved to get the
                // object back
                var result = null;
            } else {
                var result = this.parent.save(data);
            }

            return result;
        },
    };

    joli.apimodel.api = function(options) {
        this.model = options.model;
        this.xhrCallCompleted = false;
    };

    joli.apimodel.api.prototype = {
        call: function(method, params, contentBody) {
            try {
                this.xhrCallCompleted = false;
                this.xhr = Titanium.Network.createHTTPClient();
                this.xhr.apimodel = this.model.table;
                this.xhr.params = params;
                this.xhr.httpmethod = method;
                var url = this.getUrl(params);
                Ti.API.log('info', method + ' request to url ' + url);

                this.xhr.onload = function() {
                    //        Titanium.API.log('info', this.responseText);

                    if('GET' == this.httpmethod) {
                        joli.saveRecord(this.apimodel, this.responseText);
                    } else if('POST' == this.httpmethod) {
                        joli.saveRecord(this.apimodel, '[' + this.responseText + ']');
                    }

                    joli.models.get(this.apimodel).markUpdated(this.params);
                    return true;
                };
                if(Titanium.Platform.name != 'android') {
                    this.xhr.open(method, url, true);
                } else {
                    this.xhr.open(method, url, false);
                }

                this.xhr.setTimeout(60000);

                if(contentBody) {
                    this.xhr.send(contentBody);
                } else {
                    this.xhr.send();
                }
            } catch(err) {
                Titanium.UI.createAlertDialog({
                    title: "Error",
                    message: String(err),
                    buttonNames: ['OK']
                }).show();
            }

        },
        get: function(params) {
            this.call('GET', params);
        },
        getResponseValues: function() {
            var result = this.response_values;
            this.response_values = null;
            return result;
        },
        getUrl: function(params) {
            var url = this.model.options.url;

            if(params) {
                if((params.charAt(0) != '?')) {
                    url += '?';
                }
                url += params;
            }

            return url;
        },
        post: function(content) {
            this.call('POST', null, content);
        },
        setResponseValues: function(values) {
            this.response_values = values;
            this.xhrCallCompleted = true;
        }
    };

    return joli;
};

module.exports = joliApi;