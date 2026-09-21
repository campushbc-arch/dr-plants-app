'use strict';

const { DatabaseSync } = require('node:sqlite');

/**
 * Capa mínima de compatibilidad con la API usada por Dr Plants en better-sqlite3.
 *
 * Objetivo: mantener intacta la lógica V8C.12 y la misma base SQLite,
 * evitando dependencias nativas externas que Hostinger ya no puede compilar.
 */
class DatabaseCompat {
  constructor(filename, options = {}) {
    this._db = new DatabaseSync(filename, options);
    this._txDepth = 0;
    this._savepointSeq = 0;
  }

  prepare(sql) {
    return this._db.prepare(sql);
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  pragma(source, options = {}) {
    const rows = this._db.prepare(`PRAGMA ${source}`).all();

    if (options && options.simple) {
      if (!rows.length) return undefined;
      const first = rows[0];
      const keys = Object.keys(first);
      return keys.length ? first[keys[0]] : undefined;
    }

    return rows;
  }

  transaction(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Expected first argument to be a function');
    }

    const self = this;

    function createWrapper(mode) {
      return function transactionWrapper(...args) {
        const nested = self._txDepth > 0;
        const savepoint = `drplants_sp_${++self._savepointSeq}`;

        if (nested) {
          self._db.exec(`SAVEPOINT ${savepoint}`);
        } else {
          self._db.exec(`BEGIN ${mode}`);
        }

        self._txDepth += 1;

        try {
          const result = fn.apply(this, args);
          self._txDepth -= 1;

          if (nested) {
            self._db.exec(`RELEASE SAVEPOINT ${savepoint}`);
          } else {
            self._db.exec('COMMIT');
          }

          return result;
        } catch (error) {
          self._txDepth -= 1;

          try {
            if (nested) {
              self._db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              self._db.exec(`RELEASE SAVEPOINT ${savepoint}`);
            } else {
              self._db.exec('ROLLBACK');
            }
          } catch (_) {
            // Conserva el error original.
          }

          throw error;
        }
      };
    }

    const deferred = createWrapper('DEFERRED');
    deferred.deferred = deferred;
    deferred.immediate = createWrapper('IMMEDIATE');
    deferred.exclusive = createWrapper('EXCLUSIVE');

    return deferred;
  }

  close() {
    return this._db.close();
  }
}

module.exports = DatabaseCompat;
