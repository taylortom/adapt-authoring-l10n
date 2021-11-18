import { AbstractModule } from 'adapt-authoring-core';
import fs from 'fs/promises';
import globCallback from 'glob';
import path from 'path';
import Polyglot from 'node-polyglot';
import { promisify } from 'util';

/** @ignore */ const globPromise = promisify(globCallback);
/**
 * Module to handle localisation of language strings
 * @extends {AbstractModule}
 */
export default class LangModule extends AbstractModule {
  /** @override*/
  async init() {
    this.app.lang = this;

    await this.loadPhrases();
    /**
     * Reference to the Polyglot instance
     * @type {Polyglot}
     */
    this.polyglot = new Polyglot({ phrases: this.phrases, warn: this.logMissingKey.bind(this) });

    await this.app.waitForModule('config');
    /**
     * The current locale of the back-end application
     * @type {String}
     */
    this.locale = this.getConfig('locale');

    this.loadRoutes();
  }
  /**
   * Returns the languages supported by the application
   * @type {Array<String>}
   */
  get supportedLanguages() {
    return Object.keys(this.phrases);
  }
  /**
   * Loads, validates and merges all defined langage phrases
   * @return {Promise}
   */
  async loadPhrases() {
    /**
     * The loaded language phrases to be used for translation
     * @type {Object}
     */
    this.phrases = {};
    const deps = [
      { name: this.app.name, rootDir: process.cwd() },
      ...Object.values(this.app.dependencies)
    ];
    return Promise.all(deps.map(async d => Object.assign(this.phrases, await this.loadPhrasesForDir(d.rootDir))));
  }
  /**
   * Load all lang phrases for a given directory
   * @param {String} dir Directory to search
   * @return {Promise} Resolves with the phrases
   */
  async loadPhrasesForDir(dir) {
    const files = await globPromise(`lang/*.json`, { cwd: dir, realpath: true });
    const strings = {};
    await Promise.all(files.map(async f => {
      const namespace = path.basename(f).replace('.json', '');
      try {
        const contents = JSON.parse((await fs.readFile(f)).toString());
        Object.entries(contents).forEach(([k,v]) => strings[`${namespace}.${k}`] = v);
      } catch(e) {
        this.log('error', f);
      }
    }));
    return strings;
  }
  /**
   * Loads the router & routes
   * @return {Promise}
   */
  async loadRoutes() {
    const [auth, server] = await this.app.waitForModule('auth', 'server');
    const router = server.api.createChildRouter('lang');
    router.addRoute({
      route: '/:lang?',
      handlers: { get: this.requestHandler.bind(this) }
    });
    auth.unsecureRoute(router.path, 'get');
  }
  /**
   * Load all lang phrases for a language
   * @param {String} lang The language of strings to load
   * @return {Object} The phrases
   */
  getPhrasesForLang(lang) {
    const phrases = {};
    Object.entries(this.phrases).forEach(([key, value]) => {
      const i = key.indexOf('.');
      const keyLang = key.slice(0, i);
      const newKey = key.slice(i+1);
      if(keyLang === lang) phrases[newKey] = value;
    });
    return Object.keys(phrases).length > 1 ? phrases : undefined;
  }
  /**
   * Shortcut to log a missing language key
   * @param {ClientRequest} req The client request object
   * @param {ServerResponse} res The server response object
   * @param {Function} next The callback function
   */
  requestHandler(req, res, next) {
    // defaults to the request (browser) lang
    const lang = req.params.lang || req.acceptsLanguages(this.getConfig('supportedLanguages'));
    const phrases = this.getPhrasesForLang(lang);
    if(!lang || !phrases) {
      const e = new Error(this.t('error.unknownlang', { lang: lang }));
      e.statusCode = 404;
      return next(e);
    }
    res.json(phrases);
  }
  /**
   * Shortcut to log a missing language key
   * @param {String} m The missing key
   */
  logMissingKey(m) {
    const key = m.match(/"(.+)"/)[1];
    this.log('warn', this.phrases[key] ? this.t('error.missingkey', { key }) : m);
  }
  /**
   * Returns translated language string
   * @param {String} key
   * @param {...*} rest
   * @return {String}
   * @see https://airbnb.io/polyglot.js/#polyglotprototypetkey-interpolationoptions
   */
  t(key, ...rest) {
    return this.polyglot.t(`${this.locale}.${key}`, ...rest);
  }
}