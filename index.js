const redis = require("redis");
const util = require("util");
const generateKey = require("./generate-key");
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const client = redis.createClient(redisUrl);
client.get = util.promisify(client.get);

let hasBeenExtended = false;

module.exports = function(mongoose) {
  const exec = mongoose.Query.prototype.exec;
  const aggregate = mongoose.Model.aggregate;

  mongoose.Query.prototype.cache = function(time) {
    this._cache = true;

    if (time) {
      this._expire = time;
    }
    return this;
  };

  mongoose.Query.prototype.exec = async function() {
    if (!this._cache) {
      return await exec.apply(this, arguments);
    }
    console.log(`[LOG] Serving from cache`);

    const key = JSON.stringify(Object.assign({}, this.getQuery()));

    const cacheValue = await client.get(key);
    if (cacheValue) {
      const doc = JSON.parse(cacheValue);

      return Array.isArray(doc) ? doc.map(d => new this.model(d)) : new this.model(doc);
    }

    const result = await exec.apply(this, arguments);
    client.set(key, JSON.stringify(result), "EX", this._expire ? this._expire : 60);
    return result;
  };

  mongoose.Model.aggregate = function() {
    const res = aggregate.apply(this, arguments);

    if (!hasBeenExtended && res.constructor && res.constructor.name === "Aggregate") {
      extend(res.constructor);
      hasBeenExtended = true;
    }

    return res;
  };

  function extend(Aggregate) {
    const exec = Aggregate.prototype.exec;

    Aggregate.prototype.exec = async function() {
      if (!this._cache) {
        return await exec.apply(this, arguments);
      }

      console.log(`[LOG] Serving from cache`);
      const key = this.getCacheKey();
      const cacheValue = await client.get(key);
      if (cacheValue) {
        const doc = JSON.parse(cacheValue);
  
        return Array.isArray(doc) ? doc.map(d => new this.model(d)) : new this.model(doc);
      }
  
      const result = await exec.apply(this, arguments);
      client.set(key, JSON.stringify(result), "EX", this._expire ? this._expire : 60);
      return result;
    };

    Aggregate.prototype.cache = function(time) {
      this._cache = true;

      if (time) {
        this._expire = time;
      }
      return this;
    };

    Aggregate.prototype.getCacheKey = function() {
      console.log("this._pipeline",this._pipeline)
      return generateKey(this._pipeline);
    };
  }
};
