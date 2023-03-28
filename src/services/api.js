import { storageKeys } from '@/constants';
import apiConfig from '@/constants/apiConfig';
import { removeItem } from '@/utils/localStorage';
import axios from 'axios';
import { signOut } from 'next-auth/react';
import {
    getCacheAccessToken,
    getCacheUserEmail,
    getCacheRefreshToken,
    removeCacheToken,
    setCacheToken,
} from './userService';

// Handle refresh token
const axiosInstance = axios.create();
let isRefreshing = false;
let subscribers = [];

const onRefreshed = (newAccessToken) => {
    subscribers.map((cb) => cb(newAccessToken));
};

const subscribeTokenRefresh = (cb) => {
    subscribers.push(cb);
};

axiosInstance.interceptors.response.use(
    (res) => res,
    async (err) => {
        const originalConfig = err.config;

        if (originalConfig.url !== apiConfig.account.login.baseURL && err.response) {
            // Access Token was expired
            if (err.response?.status === 401 && !originalConfig._retry) {
                const handleExpireAll = () => {
                    removeCacheToken();
                    window.location.reload();
                };

                if (!getCacheRefreshToken()) {
                    handleExpireAll();
                }

                originalConfig._retry = true;
                if (!isRefreshing) {
                    isRefreshing = true;
                    const email = getCacheUserEmail();
                    axiosInstance
                        .post(apiConfig.account.refreshToken.baseURL, {
                            refreshToken: getCacheRefreshToken(),
                            email,
                        })
                        .then((rs) => {
                            const { accessToken, refreshToken } = rs.data.data;
                            setCacheToken(accessToken, refreshToken);
                            isRefreshing = false;
                            onRefreshed(accessToken);
                            subscribers = [];
                        })
                        .catch((_error) => {
                            handleExpireAll();
                            return Promise.reject(_error);
                        });
                }

                return new Promise((resolve) => {
                    subscribeTokenRefresh((newAccessToken) => {
                        originalConfig.headers.Authorization = `Bearer ${newAccessToken}`;
                        return resolve(axiosInstance(originalConfig));
                    });
                });
            }
        }
        return Promise.reject(err);
    }
);

const sendRequest = async (options, payload, cancelToken, session) => {
    const { params = {}, pathParams = {}, data = {} } = payload;
    let { method, baseURL, headers, ignoreAuth } = options;
    
    if(session?.error === "RefreshAccessTokenError" ){
        await signOut();
    }
    if (!ignoreAuth && session?.accessToken) {
        headers.Authorization = `Bearer ${session.accessToken}`;
    }

    // update path params
    for (let key of Object.keys(pathParams)) {
        const keyCompare = `:${key}`;
        if (baseURL.indexOf(keyCompare) !== -1) {
            baseURL = baseURL.replace(keyCompare, pathParams[key]);
        }
    }

    // handle multipart
    if (options.headers['Content-Type'] === 'multipart/form-data') {
        let formData = new FormData();
        console.log(headers, options);
        Object.keys(data).map((item) => {
            formData.append(item, data[item]);
        });

        return axios
            .post(options.baseURL, formData, {
                headers: {
                    Authorization: headers.Authorization,
                    'Content-type': 'multipart/form-data',
                },
            })
            .then((res) => {
                return { data: res.data };
            })
            .catch((err) => {
                console.log(err);
            });
    }
    // ...
    return axiosInstance.request({
        method,
        baseURL,
        headers,
        params,
        data,
        cancelToken,
    });
};

export { sendRequest };
