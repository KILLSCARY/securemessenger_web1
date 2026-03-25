export {};

declare global {
  module '*.js' {
    const content: any;
    export default content;
    export const any: any;
  }
  
  module './firebase.js' {
    export const auth: any;
    export const db: any;
    export const storage: any;
    export default any;
  }
  
  module '../firebase.js' {
    export const auth: any;
    export const db: any;
    export const storage: any;
    export default any;
  }
}
