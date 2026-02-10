// Logging utilities for Lambda functions

export interface LogContext {
  functionName?: string;
  requestId?: string;
  [key: string]: any;
}

export class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  private log(level: string, message: string, data?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...(data && { data }),
    };
    console.log(JSON.stringify(logEntry));
  }

  info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }

  error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }

  debug(message: string, data?: any): void {
    this.log('DEBUG', message, data);
  }
}
