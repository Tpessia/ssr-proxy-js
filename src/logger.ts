import path from 'path';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { LogLevel } from './types';

export class Logger {
    private static logLevel: LogLevel = LogLevel.None;
    private static enableConsole?: boolean;
    private static fileLogger?: winston.Logger;

    loggerId?: number;
    loggerIdStr: string = '';

    constructor(useId = true) {
        if (useId) {
            this.loggerId = Math.round(Math.random() * 99999);
            this.loggerIdStr = `[${this.loggerId}] `;
        }
    }

    error(errName: string, err: any, withStack: boolean) {
        Logger.error(errName, err, withStack, this.loggerIdStr);
    }

    warn(errName: string, err: any, withStack: boolean) {
        Logger.warn(errName, err, withStack, this.loggerIdStr);
    }

    info(msg: string) {
        Logger.info(msg, this.loggerIdStr);
    }

    debug(msg: string) {
        Logger.debug(msg, this.loggerIdStr);
    }

    static error(errName: string, err: any, withStack: boolean, prefix: string = '') {
        const logMsg = `${prefix}${this.logPrefix()}${errName}: ${this.errorStr(err)}${(withStack && ('\n' + err.stack)) || ''}`;
        if (this.logLevel >= 1) {
            if (this.enableConsole) console.log(`\x1b[31m${logMsg}\x1b[0m`);
            if (this.fileLogger) this.fileLogger.error(logMsg);
        }
    }

    static warn(errName: string, err: any, withStack: boolean, prefix: string = '') {
        const logMsg = `${prefix}${this.logPrefix()}${errName}: ${this.errorStr(err)}${(withStack && ('\n' + err.stack)) || ''}`;
        if (this.logLevel >= 2) {
            if (this.enableConsole) console.log(`\x1b[33m${logMsg}\x1b[0m`);
            if (this.fileLogger) this.fileLogger.warn(logMsg);
        }
    }

    static info(msg: string, prefix: string = '') {
        const logMsg = `${prefix}${this.logPrefix()}${msg}`;
        if (this.logLevel >= 2) {
            if (this.enableConsole) console.log(`\x1b[37m${logMsg}\x1b[0m`);
            if (this.fileLogger) this.fileLogger.info(logMsg);
        }
    }

    static debug(msg: string, prefix: string = '') {
        const logMsg = `${prefix}${this.logPrefix()}${msg}`;
        if (this.logLevel >= 3) {
            if (this.enableConsole) console.log(`\x1b[34m${logMsg}\x1b[0m`);
            if (this.fileLogger) this.fileLogger.debug(logMsg);
        }
    }

    static errorStr(err: any) {
        return err && (err.message || err.toString());
    }

    static setLevel(level: LogLevel) {
        this.logLevel = level;
    }

    static configConsole(enable: boolean) {
        this.enableConsole = enable;
    }

    static configFile(enable: boolean, dirPath: string) {
        if (!enable || !dirPath) {
            this.fileLogger = undefined;
        }

        const transport = new winston.transports.DailyRotateFile({
            filename: path.join(dirPath, 'log-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '5d'
        });

        const logger = winston.createLogger({
            exitOnError: false,
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`+(info.splat!==undefined?`${info.splat}`:" "))
            ),
            transports: [transport]
        });

        this.fileLogger = logger;
    }

    private static logPrefix() {
        return `[${new Date().toISOString()}] `;
    }
}