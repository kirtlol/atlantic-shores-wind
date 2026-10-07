import numpy as np
def lin(c):
    c=np.asarray(c,float)/255
    return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
def srgb(l):
    l=np.clip(np.asarray(l,float),0,1)
    return np.where(l<=0.0031308,12.92*l,1.055*l**(1/2.4)-0.055)*255
def hexs(c): c=np.clip(np.round(c),0,255).astype(int); return '#%02x%02x%02x'%tuple(c)
def Y(c): l=lin(c); return 0.2126*l[...,0]+0.7152*l[...,1]+0.0722*l[...,2]
F=900; TH=np.radians(3.10); YC=253; XC=380
def elev(y,x=380):
    # exact elevation of pixel using pitched camera
    r=(x-XC)/F; u=-(y-YC)/F
    vy=u*np.cos(TH)-np.sin(TH); vz=-u*np.sin(TH)-np.cos(TH)
    return np.degrees(np.arctan2(vy,np.hypot(r,vz)))
